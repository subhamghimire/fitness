/**
 * REPORT ENUMS
 * ---------------------------------------------------------------------------
 * The moderation vocabulary. It is intentionally a *closed* set, and that is the
 * single most important property of it.
 *
 * A free-text report reason produces two failure modes immediately: a taxonomy
 * that nobody can act on (every report is "other"), and a queue where the two
 * cases that matter — harassment and self-harm — are indistinguishable from
 * noise. A closed set forces the reasons to be distinguishable at the point a
 * report is filed, which is the only moment the reporter actually has the context.
 *
 * `ReportStatus` is included but **nothing in the product acts on it yet**. It is
 * here because a report that cannot express "someone looked at this" is a report
 * table that will be replaced the first time triage needs it, and replacing it
 * means losing the history. The transitions are constrained by the CHECK
 * constraint in the migration, so an out-of-band write cannot produce a report
 * that was both resolved and dismissed.
 */

/**
 * Why something is being reported. Chosen by the reporter, at the moment they
 * file it.
 */
export enum ReportReason {
  SPAM = "spam",
  HARASSMENT = "harassment",
  HATE = "hate",
  SEXUAL = "sexual_content",
  VIOLENCE = "violence",
  SELF_HARM = "self_harm",
  IMPERSONATION = "impersonation",
  MISINFORMATION = "misinformation",
  COPYRIGHT = "copyright",
  OTHER = "other"
}

/**
 * What a report is about.
 *
 * `USER` is a first-class target, not a fallback, and it is the *only* way to
 * report behaviour that leaves no artifact: a user who is stalking someone in
 * their DMs has written no post worth reporting. Reporting a private post is
 * therefore deliberately not possible — the reporter cannot see it, so there is
 * nothing to describe, and the honest path is `USER`.
 */
export enum ReportTargetType {
  USER = "user",
  POST = "post",
  COMMENT = "comment"
}

/**
 * Triage state.
 *
 * `REPORTED → UNDER_REVIEW → { RESOLVED, DISMISSED }`, and a report may be
 * dismissed straight from `REPORTED` (the common case: the reporter was wrong).
 * There is deliberately no path back from a terminal state — reopening a resolved
 * report is a moderation-tool concern, not an API one.
 */
export enum ReportStatus {
  REPORTED = "reported",
  UNDER_REVIEW = "under_review",
  RESOLVED = "resolved",
  DISMISSED = "dismissed"
}

/** Statuses a report can never leave. */
export const TERMINAL_REPORT_STATUSES: readonly ReportStatus[] = [ReportStatus.RESOLVED, ReportStatus.DISMISSED];

/**
 * Reasons that must reach a human quickly regardless of queue depth.
 *
 * Declared here rather than inferred from the reason value, so that changing a
 * reason's *wording* never silently changes its urgency, and so the priority is
 * reviewable in one place.
 */
export const URGENT_REPORT_REASONS: readonly ReportReason[] = [ReportReason.SELF_HARM, ReportReason.VIOLENCE];
