"""Perseverance MEDA Environmental Intelligence Service.

Authoritative historical environmental telemetry from the NASA Planetary Data
System (PDS4 Atmospheres Node), bundle: urn:nasa:pds:mars2020_meda.
"""
import os
import glob
import csv
import logging
from collections import OrderedDict
from typing import Optional, List, Dict, Any, Tuple
from app.core.errors import NotFoundException, InvalidRequestException
from app.schemas.environment import (
    SensorProvenance,
    ATSObservation,
    PressureObservation,
    TIRSObservation,
    WindObservation,
    RDSObservation,
    MEDASolTelemetryResponse,
    SensorSummaryStats,
    MEDASolSummaryResponse,
    TimeSeriesSample,
    MEDASolTimeSeriesResponse,
)

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "meda")


def _parse_float(val: Optional[str]) -> Optional[float]:
    """Parse string to float, evaluating empty strings and 999999999 as None."""
    if val is None or val == "" or val.isspace() or val == "999999999":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _parse_int(val: Optional[str]) -> Optional[int]:
    """Parse string to int, evaluating empty strings and 999999999 as None."""
    if val is None or val == "" or val.isspace() or val == "999999999":
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


class MedaService:
    MAX_TELEMETRY_CACHE = 256
    MAX_TIMESERIES_CACHE = 128
    MAX_SUMMARY_CACHE = 128

    def __init__(self, data_dir: str = DATA_DIR):
        self.data_dir = data_dir
        self._telemetry_cache: OrderedDict[Tuple[int, Optional[float]], MEDASolTelemetryResponse] = OrderedDict()
        self._summary_cache: OrderedDict[int, MEDASolSummaryResponse] = OrderedDict()
        self._timeseries_cache: OrderedDict[Tuple[int, int], MEDASolTimeSeriesResponse] = OrderedDict()

    def get_available_sols(self) -> List[int]:
        """Return sorted list of Sols available in local verified PDS store."""
        if not os.path.exists(self.data_dir):
            return []
        sols = []
        for entry in os.listdir(self.data_dir):
            if entry.startswith("sol_"):
                try:
                    sols.append(int(entry.replace("sol_", "")))
                except ValueError:
                    pass
        return sorted(sols)

    def _get_sol_dir(self, sol: int) -> str:
        """Find the directory for a given sol."""
        if sol < 0:
            raise InvalidRequestException(f"Sol must be a non-negative integer, received {sol}")
        candidates = [
            os.path.join(self.data_dir, f"sol_{sol:04d}"),
            os.path.join(self.data_dir, f"sol_{sol}")
        ]
        for c in candidates:
            if os.path.isdir(c):
                return c
        raise NotFoundException(f"No MEDA telemetry archived for Sol {sol}")

    def _find_file(self, sol_dir: str, pattern: str) -> Optional[str]:
        """Find matching file in sol directory."""
        matches = glob.glob(os.path.join(sol_dir, pattern))
        return matches[0] if matches else None

    def get_sol_telemetry(self, sol: int, requested_sclk: Optional[float] = None) -> MEDASolTelemetryResponse:
        """Return synchronized or coincident multi-sensor telemetry for a Sol."""
        cache_key = (sol, requested_sclk)
        if cache_key in self._telemetry_cache:
            self._telemetry_cache.move_to_end(cache_key)
            return self._telemetry_cache[cache_key]

        sol_dir = self._get_sol_dir(sol)

        # 1. Calibrated Air Temperature (CAL_ATS)
        ats_file = self._find_file(sol_dir, "*CAL_ATS*.CSV")
        ats_obs: Optional[ATSObservation] = None
        target_sclk = requested_sclk

        if ats_file:
            with open(ats_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                header = next(reader)
                rows = list(reader)

            if rows:
                if target_sclk is None:
                    # Select representative midday observation
                    target_row = rows[len(rows) // 2]
                else:
                    # Match closest SCLK
                    target_row = min(rows, key=lambda r: abs(float(r[0]) - target_sclk))

                row_dict = dict(zip(header, target_row))
                sclk = float(target_row[0])
                if target_sclk is None:
                    target_sclk = sclk

                ats_obs = ATSObservation(
                    available=True,
                    sclk=sclk,
                    lmst=row_dict.get("LMST", ""),
                    ltst=row_dict.get("LTST", ""),
                    ats_local_temp1_k=_parse_float(row_dict.get("ATS_LOCAL_TEMP1")),
                    ats_local_temp2_k=_parse_float(row_dict.get("ATS_LOCAL_TEMP2")),
                    ats_local_temp3_k=_parse_float(row_dict.get("ATS_LOCAL_TEMP3")),
                    ats_local_temp4_k=_parse_float(row_dict.get("ATS_LOCAL_TEMP4")),
                    ats_local_temp5_k=_parse_float(row_dict.get("ATS_LOCAL_TEMP5")),
                    rover_still=_parse_int(row_dict.get("ROVER_STILL")),
                    provenance=SensorProvenance(
                        product_lid=f"urn:nasa:pds:mars2020_meda:data_calibrated_env:{os.path.basename(ats_file).lower()}",
                        product_filename=os.path.basename(ats_file),
                        processing_level="Calibrated"
                    )
                )

        anchor_sclk = target_sclk if target_sclk is not None else 0.0

        # 2. Derived Pressure (DER_PS)
        ps_file = self._find_file(sol_dir, "*DER_PS*.CSV")
        ps_obs: Optional[PressureObservation] = None
        if ps_file:
            with open(ps_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                header = next(reader)
                rows = list(reader)
            if rows:
                matched_row = min(rows, key=lambda r: abs(float(r[0]) - anchor_sclk))
                row_dict = dict(zip(header, matched_row))
                p_val = _parse_float(row_dict.get("PRESSURE"))
                if p_val is not None:
                    ps_obs = PressureObservation(
                        available=True,
                        sclk=float(matched_row[0]),
                        lmst=row_dict.get("LMST", ""),
                        ltst=row_dict.get("LTST", ""),
                        pressure_pa=p_val,
                        pressure_uncertainty=_parse_float(row_dict.get("PRESSURE_UNCERTAINTY")),
                        source_declared_unit="kelvin",
                        physical_unit_status="UNRESOLVED_IN_UPSTREAM_METADATA",
                        transducer_id=_parse_int(row_dict.get("TRANSDUCER")) or 1,
                        provenance=SensorProvenance(
                            product_lid=f"urn:nasa:pds:mars2020_meda:data_derived_env:{os.path.basename(ps_file).lower()}",
                            product_filename=os.path.basename(ps_file),
                            processing_level="Derived"
                        )
                    )

        # 3. TIRS (CAL_TIRS & DER_TIRS)
        tirs_cal_file = self._find_file(sol_dir, "*CAL_TIRS*.CSV")
        tirs_der_file = self._find_file(sol_dir, "*DER_TIRS*.CSV")
        tirs_obs: Optional[TIRSObservation] = None

        if tirs_cal_file:
            with open(tirs_cal_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                header_cal = next(reader)
                rows_cal = list(reader)
            if rows_cal:
                matched_cal = min(rows_cal, key=lambda r: abs(float(r[0]) - anchor_sclk))
                cal_dict = dict(zip(header_cal, matched_cal))

                der_upward_lw = None
                der_downward_lw = None
                if tirs_der_file:
                    with open(tirs_der_file, "r", encoding="ascii") as f:
                        reader_der = csv.reader(f)
                        header_der = next(reader_der)
                        rows_der = list(reader_der)
                    if rows_der:
                        matched_der = min(rows_der, key=lambda r: abs(float(r[0]) - anchor_sclk))
                        der_dict = dict(zip(header_der, matched_der))
                        der_upward_lw = _parse_float(der_dict.get("UPWARD_LW_IRRADIANCE"))
                        der_downward_lw = _parse_float(der_dict.get("DOWNWARD_LW_IRRADIANCE"))

                tirs_obs = TIRSObservation(
                    available=True,
                    sclk=float(matched_cal[0]),
                    lmst=cal_dict.get("LMST", ""),
                    ltst=cal_dict.get("LTST", ""),
                    air_temp_k=_parse_float(cal_dict.get("AIR_TEMP")),
                    ground_brightness_temp_k=_parse_float(cal_dict.get("GROUND_TEMP")),
                    ground_temp_uncertainty_k=_parse_float(cal_dict.get("GROUND_TEMP_UNCERTAINTY")),
                    upward_sw_irradiance_cal_wm2=_parse_float(cal_dict.get("UPWARD_SW_IRRADIANCE")),
                    upward_lw_irradiance_cal_wm2=_parse_float(cal_dict.get("UPWARD_LW_IRRADIANCE")),
                    upward_lw_flux_derived_wm2=der_upward_lw,
                    downward_lw_flux_derived_wm2=der_downward_lw,
                    sun_outside_tirs_fov=_parse_int(cal_dict.get("SUN_OUTSIDE_TIRS_FOV")),
                    ground_footprint_not_in_shadow=_parse_int(cal_dict.get("TIRS_GROUND_FOOTPRINT_NOT_IN_SHADOW")),
                    provenance=SensorProvenance(
                        product_lid=f"urn:nasa:pds:mars2020_meda:data_calibrated_env:{os.path.basename(tirs_cal_file).lower()}",
                        product_filename=os.path.basename(tirs_cal_file),
                        processing_level="Calibrated"
                    )
                )

        # 4. Wind Sensor (DER_WS)
        ws_file = self._find_file(sol_dir, "*DER_WS*.CSV")
        wind_obs: WindObservation
        if ws_file:
            with open(ws_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                header = next(reader)
                rows = list(reader)
            if rows:
                matched_row = min(rows, key=lambda r: abs(float(r[0]) - anchor_sclk))
                row_dict = dict(zip(header, matched_row))
                speed = _parse_float(row_dict.get("HORIZONTAL_WIND_SPEED"))
                direction = _parse_float(row_dict.get("WIND_DIRECTION"))
                v_speed = _parse_float(row_dict.get("VERTICAL_WIND_SPEED"))

                wind_obs = WindObservation(
                    available=True if speed is not None else False,
                    status_reason="OPERATIONAL" if speed is not None else "SENSOR_UNCALIBRATED_OR_STAGNANT",
                    sclk=float(matched_row[0]),
                    lmst=row_dict.get("LMST"),
                    ltst=row_dict.get("LTST"),
                    horizontal_wind_speed_ms=speed,
                    wind_direction_deg=direction,
                    vertical_wind_speed_ms=v_speed,
                    rover_still=_parse_int(row_dict.get("ROVER_STILL")),
                    provenance=SensorProvenance(
                        product_lid=f"urn:nasa:pds:mars2020_meda:data_derived_env:{os.path.basename(ws_file).lower()}",
                        product_filename=os.path.basename(ws_file),
                        processing_level="Derived"
                    )
                )
            else:
                wind_obs = WindObservation(available=False, status_reason="EMPTY_PRODUCT")
        else:
            wind_obs = WindObservation(available=False, status_reason="PRODUCT_NOT_ARCHIVED_IN_PDS")

        # 5. Radiation & Dust Sensor (CAL_RDS)
        rds_file = self._find_file(sol_dir, "*CAL_RDS*.CSV")
        rds_obs: Optional[RDSObservation] = None
        if rds_file:
            with open(rds_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                header = next(reader)
                rows = list(reader)
            if rows:
                matched_row = min(rows, key=lambda r: abs(float(r[0]) - anchor_sclk))
                row_dict = dict(zip(header, matched_row))

                lat_channels = [_parse_float(row_dict.get(f"RDS_LAT_{i}")) for i in range(2, 9)]
                top_channels = [_parse_float(row_dict.get(f"RDS_TOP_{i}")) for i in range(1, 9)]

                rds_obs = RDSObservation(
                    available=True,
                    sclk=float(matched_row[0]),
                    lmst=row_dict.get("LMST", ""),
                    ltst=row_dict.get("LTST", ""),
                    rds_lat_1_amp=_parse_float(row_dict.get("RDS_LAT_1")),
                    rds_lat_channels=lat_channels,
                    rds_top_channels=top_channels,
                    optical_channels_unit="watt/m2",
                    physical_interpretation_status="UNRESOLVED_RADIANCE_VS_FLUX",
                    rover_hga_still=_parse_int(row_dict.get("ROVER_HGA_STILL")),
                    rover_still=_parse_int(row_dict.get("ROVER_STILL")),
                    provenance=SensorProvenance(
                        product_lid=f"urn:nasa:pds:mars2020_meda:data_calibrated_env:{os.path.basename(rds_file).lower()}",
                        product_filename=os.path.basename(rds_file),
                        processing_level="Calibrated"
                    )
                )

        response = MEDASolTelemetryResponse(
            sol=sol,
            site_location="Jezero Crater, Mars",
            data_source="NASA Planetary Data System (PDS4 Atmospheres Node)",
            bundle_lid="urn:nasa:pds:mars2020_meda",
            is_historical_archive=True,
            ats=ats_obs,
            pressure=ps_obs,
            tirs=tirs_obs,
            wind=wind_obs,
            rds=rds_obs,
            dust_optical_depth=None
        )

        self._telemetry_cache[cache_key] = response
        if len(self._telemetry_cache) > self.MAX_TELEMETRY_CACHE:
            self._telemetry_cache.popitem(last=False)
        return response

    def get_sol_timeseries(self, sol: int, max_points: int = 100) -> MEDASolTimeSeriesResponse:
        """Return downsampled time series for plotting diurnal trends."""
        cache_key = (sol, max_points)
        if cache_key in self._timeseries_cache:
            self._timeseries_cache.move_to_end(cache_key)
            return self._timeseries_cache[cache_key]

        sol_dir = self._get_sol_dir(sol)
        ats_file = self._find_file(sol_dir, "*CAL_ATS*.CSV")
        ps_file = self._find_file(sol_dir, "*DER_PS*.CSV")
        tirs_file = self._find_file(sol_dir, "*CAL_TIRS*.CSV")
        ws_file = self._find_file(sol_dir, "*DER_WS*.CSV")
        rds_file = self._find_file(sol_dir, "*CAL_RDS*.CSV")

        samples: List[TimeSeriesSample] = []

        if ats_file:
            with open(ats_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                header = next(reader)
                rows = list(reader)

            step = max(1, len(rows) // max_points)
            sampled_rows = rows[::step][:max_points]

            # Index lookups for auxiliary files
            ps_rows = []
            if ps_file:
                with open(ps_file, "r", encoding="ascii") as f:
                    r = csv.reader(f)
                    ps_h = next(r)
                    ps_rows = list(r)

            tirs_rows = []
            if tirs_file:
                with open(tirs_file, "r", encoding="ascii") as f:
                    r = csv.reader(f)
                    tirs_h = next(r)
                    tirs_rows = list(r)

            ws_rows = []
            if ws_file:
                with open(ws_file, "r", encoding="ascii") as f:
                    r = csv.reader(f)
                    ws_h = next(r)
                    ws_rows = list(r)

            rds_rows = []
            if rds_file:
                with open(rds_file, "r", encoding="ascii") as f:
                    r = csv.reader(f)
                    rds_h = next(r)
                    rds_rows = list(r)

            ps_p_idx = ps_h.index("PRESSURE") if ps_file and "PRESSURE" in ps_h else None
            tirs_air_idx = tirs_h.index("AIR_TEMP") if tirs_file and "AIR_TEMP" in tirs_h else None
            tirs_gnd_idx = tirs_h.index("GROUND_TEMP") if tirs_file and "GROUND_TEMP" in tirs_h else None
            ws_spd_idx = ws_h.index("HORIZONTAL_WIND_SPEED") if ws_file and "HORIZONTAL_WIND_SPEED" in ws_h else None
            ws_dir_idx = ws_h.index("WIND_DIRECTION") if ws_file and "WIND_DIRECTION" in ws_h else None
            rds_top7_idx = rds_h.index("RDS_TOP_7") if rds_file and "RDS_TOP_7" in rds_h else None

            # Sub-sample matching
            for row in sampled_rows:
                sclk = float(row[0])
                lmst = row[1]
                ltst = row[2]
                t1 = _parse_float(row[3])

                p_val = None
                if ps_rows and ps_p_idx is not None:
                    nearest_ps = min(ps_rows[::max(1, len(ps_rows)//max_points)], key=lambda r: abs(float(r[0]) - sclk))
                    if abs(float(nearest_ps[0]) - sclk) <= 15.0:
                        p_val = _parse_float(nearest_ps[ps_p_idx])

                air_temp = None
                gnd_temp = None
                if tirs_rows and tirs_air_idx is not None:
                    nearest_tirs = min(tirs_rows[::max(1, len(tirs_rows)//max_points)], key=lambda r: abs(float(r[0]) - sclk))
                    if abs(float(nearest_tirs[0]) - sclk) <= 15.0:
                        air_temp = _parse_float(nearest_tirs[tirs_air_idx])
                        gnd_temp = _parse_float(nearest_tirs[tirs_gnd_idx])

                w_spd = None
                w_dir = None
                if ws_rows and ws_spd_idx is not None:
                    nearest_ws = min(ws_rows[::max(1, len(ws_rows)//max_points)], key=lambda r: abs(float(r[0]) - sclk))
                    if abs(float(nearest_ws[0]) - sclk) <= 15.0:
                        w_spd = _parse_float(nearest_ws[ws_spd_idx])
                        w_dir = _parse_float(nearest_ws[ws_dir_idx])

                top_7 = None
                if rds_rows and rds_top7_idx is not None:
                    nearest_rds = min(rds_rows[::max(1, len(rds_rows)//max_points)], key=lambda r: abs(float(r[0]) - sclk))
                    if abs(float(nearest_rds[0]) - sclk) <= 15.0:
                        top_7 = _parse_float(nearest_rds[rds_top7_idx])

                samples.append(
                    TimeSeriesSample(
                        sclk=sclk,
                        lmst=lmst,
                        ltst=ltst,
                        ats_temp1_k=t1,
                        pressure_pa=p_val,
                        air_temp_k=air_temp,
                        ground_brightness_temp_k=gnd_temp,
                        wind_speed_ms=w_spd,
                        wind_direction_deg=w_dir,
                        rds_top_7=top_7
                    )
                )

        resp = MEDASolTimeSeriesResponse(
            sol=sol,
            site_location="Jezero Crater, Mars",
            is_historical_archive=True,
            samples=samples,
            total_samples=len(samples)
        )
        self._timeseries_cache[cache_key] = resp
        if len(self._timeseries_cache) > self.MAX_TIMESERIES_CACHE:
            self._timeseries_cache.popitem(last=False)
        return resp

    def get_sol_summary(self, sol: int) -> MEDASolSummaryResponse:
        """Compute verified statistics across the Sol."""
        if sol in self._summary_cache:
            self._summary_cache.move_to_end(sol)
            return self._summary_cache[sol]

        sol_dir = self._get_sol_dir(sol)

        sensors_available = {
            "ats": False,
            "pressure": False,
            "tirs": False,
            "wind": False,
            "rds": False
        }
        summaries: Dict[str, SensorSummaryStats] = {}

        # 1. ATS
        ats_file = self._find_file(sol_dir, "*CAL_ATS*.CSV")
        if ats_file:
            sensors_available["ats"] = True
            with open(ats_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                h = next(reader)
                rows = list(reader)
            vals = [_parse_float(r[3]) for r in rows]
            valid_vals = [v for v in vals if v is not None]
            summaries["ats"] = SensorSummaryStats(
                sensor="Air Temperature (ATS1)",
                available=True,
                status_reason="OPERATIONAL",
                total_records=len(rows),
                valid_records=len(valid_vals),
                min_value=min(valid_vals) if valid_vals else None,
                max_value=max(valid_vals) if valid_vals else None,
                mean_value=round(sum(valid_vals)/len(valid_vals), 2) if valid_vals else None,
                unit="K"
            )

        # 2. Pressure
        ps_file = self._find_file(sol_dir, "*DER_PS*.CSV")
        if ps_file:
            sensors_available["pressure"] = True
            with open(ps_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                h = next(reader)
                rows = list(reader)
            idx = h.index("PRESSURE")
            vals = [_parse_float(r[idx]) for r in rows]
            valid_vals = [v for v in vals if v is not None]
            summaries["pressure"] = SensorSummaryStats(
                sensor="Atmospheric Pressure (PS)",
                available=True,
                status_reason="OPERATIONAL",
                total_records=len(rows),
                valid_records=len(valid_vals),
                min_value=min(valid_vals) if valid_vals else None,
                max_value=max(valid_vals) if valid_vals else None,
                mean_value=round(sum(valid_vals)/len(valid_vals), 2) if valid_vals else None,
                unit="Pa"
            )

        # 3. TIRS Ground
        tirs_file = self._find_file(sol_dir, "*CAL_TIRS*.CSV")
        if tirs_file:
            sensors_available["tirs"] = True
            with open(tirs_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                h = next(reader)
                rows = list(reader)
            gnd_idx = h.index("GROUND_TEMP")
            vals = [_parse_float(r[gnd_idx]) for r in rows]
            valid_vals = [v for v in vals if v is not None]
            summaries["tirs"] = SensorSummaryStats(
                sensor="Ground Brightness Temp (TIRS)",
                available=True,
                status_reason="OPERATIONAL",
                total_records=len(rows),
                valid_records=len(valid_vals),
                min_value=min(valid_vals) if valid_vals else None,
                max_value=max(valid_vals) if valid_vals else None,
                mean_value=round(sum(valid_vals)/len(valid_vals), 2) if valid_vals else None,
                unit="K"
            )

        # 4. Wind
        ws_file = self._find_file(sol_dir, "*DER_WS*.CSV")
        if ws_file:
            with open(ws_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                h = next(reader)
                rows = list(reader)
            idx = h.index("HORIZONTAL_WIND_SPEED")
            vals = [_parse_float(r[idx]) for r in rows]
            valid_vals = [v for v in vals if v is not None]
            has_data = len(valid_vals) > 0
            sensors_available["wind"] = has_data
            summaries["wind"] = SensorSummaryStats(
                sensor="Wind Speed (WS)",
                available=has_data,
                status_reason="OPERATIONAL" if has_data else "SENSOR_UNCALIBRATED",
                total_records=len(rows),
                valid_records=len(valid_vals),
                min_value=min(valid_vals) if valid_vals else None,
                max_value=max(valid_vals) if valid_vals else None,
                mean_value=round(sum(valid_vals)/len(valid_vals), 2) if valid_vals else None,
                unit="m/s"
            )
        else:
            sensors_available["wind"] = False
            summaries["wind"] = SensorSummaryStats(
                sensor="Wind Speed (WS)",
                available=False,
                status_reason="PRODUCT_NOT_ARCHIVED_IN_PDS",
                total_records=0,
                valid_records=0,
                unit="m/s"
            )

        # 5. RDS
        rds_file = self._find_file(sol_dir, "*CAL_RDS*.CSV")
        if rds_file:
            sensors_available["rds"] = True
            with open(rds_file, "r", encoding="ascii") as f:
                reader = csv.reader(f)
                h = next(reader)
                rows = list(reader)
            idx = h.index("RDS_TOP_7")
            vals = [_parse_float(r[idx]) for r in rows]
            valid_vals = [v for v in vals if v is not None]
            summaries["rds"] = SensorSummaryStats(
                sensor="Radiation Channel 7 (RDS TOP7)",
                available=True,
                status_reason="OPERATIONAL",
                total_records=len(rows),
                valid_records=len(valid_vals),
                min_value=min(valid_vals) if valid_vals else None,
                max_value=max(valid_vals) if valid_vals else None,
                mean_value=round(sum(valid_vals)/len(valid_vals), 2) if valid_vals else None,
                unit="W/m2"
            )

        resp = MEDASolSummaryResponse(
            sol=sol,
            site_location="Jezero Crater, Mars",
            data_source="NASA Planetary Data System (PDS4 Atmospheres Node)",
            bundle_lid="urn:nasa:pds:mars2020_meda",
            is_historical_archive=True,
            sensors_available=sensors_available,
            sensor_summaries=summaries,
            time_coverage={
                "sol": sol,
                "dataset_provenance": "NASA PDS4 Archive (Perseverance MEDA)"
            }
        )
        self._summary_cache[sol] = resp
        if len(self._summary_cache) > self.MAX_SUMMARY_CACHE:
            self._summary_cache.popitem(last=False)
        return resp


meda_service = MedaService()

