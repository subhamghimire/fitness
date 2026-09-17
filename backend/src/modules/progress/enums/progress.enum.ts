/**
 * PROGRESS DOMAIN ENUMS
 *
 * `PersonalRecordType` is the canonical set of derived strength/conditioning
 * records. Every PR row is identified by this type plus a numeric `value`.
 * Units are encoded in the type name (kg / meters / seconds) so records are
 * deterministic and unit-safe without a separate units column.
 */
export enum PersonalRecordType {
  BEST_WEIGHT_KG = "best_weight_kg",
  BEST_REPS = "best_reps",
  BEST_VOLUME_KG = "best_volume_kg",
  BEST_ESTIMATED_1RM_KG = "best_estimated_1rm_kg",
  BEST_DISTANCE_M = "best_distance_m",
  BEST_TIME_SECONDS = "best_time_seconds"
}

export enum PrDisplayUnit {
  KG = "kg",
  REPS = "reps",
  METERS = "m",
  SECONDS = "s"
}

export enum VolumeGranularity {
  DAY = "day",
  WEEK = "week",
  MONTH = "month"
}

export enum FrequencyGranularity {
  DAY = "day",
  WEEK = "week",
  MONTH = "month"
}
