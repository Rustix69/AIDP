import type { RegisterSource } from "./types";

/**
 * Data Standards.
 *
 * Ownership, modelling, quality, movement and lifecycle. The security of data —
 * classification, encryption, residency, disposal — lives in the Security
 * register rather than being restated here, because a rule stated in two
 * registers is a rule that will be changed in one of them.
 */
export const data: RegisterSource = {
  key: "data",
  prefix: "DAT",
  title: "Data Standards",
  scope:
    "Ownership, modelling, quality, movement and lifecycle of data across the estate.",
  rows: [
    // ---- Governance --------------------------------------------------
    {
      category: "Data Governance",
      name: "Named Data Owner",
      status: "Mandatory",
      statement:
        "Every data set a design creates or consumes must have a named owning role accountable for its definition, quality and access.",
      rationale:
        "Unowned data is data whose definition nobody can settle and whose quality nobody is answerable for.",
      requirements: [
        "Each data set names an owning role rather than an individual.",
        "The owner's remit covers definition, quality and access.",
        "Data consumed from another system names that system's owner.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Governance",
      name: "Registered in the Data Catalogue",
      status: "Mandatory",
      statement:
        "Data sets of enterprise significance must be registered in the data catalogue with their owner, classification, source and definition.",
      rationale:
        "Data nobody can find is rebuilt rather than reused, which is how the estate acquires six versions of the same customer record.",
      requirements: [
        "Enterprise-significant data sets are registered.",
        "Each entry carries owner, classification, source and definition.",
        "The entry is created at design time rather than after go-live.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Governance",
      name: "Lineage Recorded",
      status: "Recommended",
      statement:
        "Designs that derive or transform data should record its lineage from source to consumption, including the transformations applied.",
      rationale:
        "Without lineage a disputed figure cannot be traced, so the dispute is settled by whoever is most senior rather than by evidence.",
      requirements: [
        "Source systems are identified for each derived data set.",
        "Transformations are described rather than only implemented.",
        "Lineage is recorded where it can be read by someone outside the team.",
      ],
      owner: "Data Governance",
    },

    // ---- Modelling ---------------------------------------------------
    {
      category: "Data Modelling",
      name: "Defined Schema",
      status: "Mandatory",
      statement:
        "Persisted and exchanged data must have an explicit schema stating field names, types, optionality and meaning; a design must not rely on an implicit structure.",
      rationale:
        "An implicit structure is a contract nobody can check, so it is broken by a change that looked harmless.",
      requirements: [
        "Each persisted entity and exchanged message has a schema.",
        "Types and optionality are stated for every field.",
        "The meaning of non-obvious fields is documented.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Modelling",
      name: "Stable Identifiers",
      status: "Mandatory",
      statement:
        "Business entities must carry an identifier that does not change over the entity's life and does not encode attributes that can change.",
      rationale:
        "An identifier built out of attributes has to change when an attribute does, and every system that stored it is then wrong.",
      requirements: [
        "Each entity has an identifier stable for its lifetime.",
        "Identifiers do not encode mutable attributes.",
        "External identifiers are not reused after an entity is deleted.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Modelling",
      name: "Enterprise Data Definitions",
      status: "Mandatory",
      statement:
        "Shared business entities must use the enterprise definition of their core attributes; a design must not redefine a shared term to mean something local.",
      rationale:
        "Two systems that both report 'active customers' against different definitions produce two true numbers and one argument.",
      requirements: [
        "Shared entities use enterprise definitions.",
        "Local variants are named differently rather than redefined.",
        "Divergences are raised with data governance rather than absorbed.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Modelling",
      name: "Explicit Units and Time Zones",
      status: "Mandatory",
      statement:
        "Quantities must state their unit and currency, and timestamps must carry an explicit time zone or be stored in UTC.",
      rationale:
        "Unqualified quantities and local timestamps are correct in the system that wrote them and wrong everywhere else.",
      requirements: [
        "Monetary values carry a currency.",
        "Measured quantities carry a unit.",
        "Timestamps are UTC or carry an offset.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Modelling",
      name: "Schema Evolution",
      status: "Mandatory",
      statement:
        "A change to a published schema must be backward compatible, or must be issued as a new version with the previous version supported for a stated period.",
      rationale:
        "Consumers deploy on their own schedule, so a breaking change that is not versioned breaks them at a time of nobody's choosing.",
      requirements: [
        "Additive changes keep existing fields and their meaning.",
        "Breaking changes are issued as a new version.",
        "A support period for the previous version is stated.",
      ],
      owner: "Data Architecture",
    },

    // ---- Quality -----------------------------------------------------
    {
      category: "Data Quality",
      name: "Validation at the Point of Entry",
      status: "Mandatory",
      statement:
        "Data must be validated against its schema and business rules where it enters the estate, rather than being corrected downstream.",
      rationale:
        "Bad data that is admitted spreads to every consumer, and correcting it downstream corrects one copy of it.",
      requirements: [
        "Entry points state the validation they apply.",
        "Rejected records are reported rather than silently dropped.",
        "Downstream correction is not the primary control.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Quality",
      name: "Measured Quality Rules",
      status: "Recommended",
      statement:
        "Designs should state the quality rules that matter for their data — completeness, validity, uniqueness, timeliness — and how each is measured.",
      rationale:
        "Quality that is asserted rather than measured degrades invisibly until a report is visibly wrong.",
      requirements: [
        "Quality dimensions that matter are named.",
        "A measurement is defined for each.",
        "A threshold and an owner for breaches are stated.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Quality",
      name: "Reconciliation of Copies",
      status: "Mandatory",
      statement:
        "Where data is copied between systems, the design must state how the copy is reconciled against its source and what happens when they disagree.",
      rationale:
        "Copies drift. A copy with no reconciliation is trusted exactly as much as the original and deserves less.",
      requirements: [
        "A reconciliation mechanism is stated for each copy.",
        "A frequency is stated.",
        "The action on a discrepancy is stated.",
      ],
      owner: "Data Architecture",
    },

    // ---- Architecture ------------------------------------------------
    {
      category: "Data Architecture",
      name: "Single Source of Truth",
      status: "Mandatory",
      statement:
        "Each data element must have one authoritative source; other holders must be identified as copies and must not be written to independently.",
      rationale:
        "Independent writes to two holders of one fact produce two different truths and no way to choose between them.",
      requirements: [
        "The authoritative source is named for each shared element.",
        "Copies are read-only with respect to the shared element.",
        "Any write-back path to the source is explicit.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Architecture",
      name: "Separate Operational and Analytical Workloads",
      status: "Mandatory",
      statement:
        "Analytical and reporting queries must not run against the operational store that serves live transactions.",
      rationale:
        "An unbounded analytical query against a transactional database is an outage with a business sponsor.",
      requirements: [
        "Reporting consumers are served from a separate store or replica.",
        "The replication mechanism and its lag are stated.",
        "No ad-hoc query access to the operational store is granted.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Architecture",
      name: "Stated Consistency Model",
      status: "Mandatory",
      statement:
        "A design holding the same data in more than one place must state whether consumers see it consistently or eventually, and the staleness consumers must tolerate.",
      rationale:
        "Consumers assume consistency unless told otherwise, and build logic that is correct only under that assumption.",
      requirements: [
        "The consistency model is stated for each replicated data set.",
        "An expected staleness bound is given.",
        "Consumers that cannot tolerate staleness are identified.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Architecture",
      name: "Open Storage Formats",
      status: "Recommended",
      statement:
        "Analytical data should be stored in open, non-proprietary formats so it remains readable independently of the tool that wrote it.",
      rationale:
        "A proprietary format makes the exit cost of a product equal to the cost of rewriting every consumer of its data.",
      requirements: [
        "Analytical storage formats are named.",
        "Formats are readable by more than one engine.",
        "Any proprietary format carries an export route.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Architecture",
      name: "Reference Data Managed Centrally",
      status: "Recommended",
      statement:
        "Code lists and reference data shared across systems should be maintained in one place and distributed, rather than being duplicated in each system.",
      rationale:
        "Reference data copied into each system diverges silently, and the divergence is found during a reconciliation nobody budgeted for.",
      requirements: [
        "Shared code lists are sourced from a single master.",
        "Distribution to consumers is automated.",
        "Local additions are prohibited or reconciled back.",
      ],
      owner: "Data Governance",
    },

    // ---- Movement ----------------------------------------------------
    {
      category: "Data Movement",
      name: "Idempotent Loads",
      status: "Mandatory",
      statement:
        "A data load must be safe to re-run; replaying a batch or a message must not create duplicate records or double-count values.",
      rationale:
        "Every pipeline is re-run eventually, because every pipeline fails eventually, and recovery is only safe if replay is.",
      requirements: [
        "Records carry a key that makes a repeat recognisable.",
        "Re-running a load produces the same end state.",
        "Aggregations are recomputed rather than incremented blindly.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Movement",
      name: "Failure Visibility",
      status: "Mandatory",
      statement:
        "A failed or partial data load must raise an alert and must not leave consumers reading a partially loaded data set as though it were complete.",
      rationale:
        "A silent partial load is worse than an outage: consumers act on numbers that look complete and are not.",
      requirements: [
        "Load failures raise an alert to a named recipient.",
        "Consumers cannot read a partially written data set.",
        "The completion state of each load is recorded.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Movement",
      name: "No Point-to-Point Extracts",
      status: "Recommended",
      statement:
        "Systems should not take bespoke file extracts directly from one another where a governed interface or a shared data platform can serve the need.",
      rationale:
        "Bespoke extracts multiply until the real integration architecture is a set of scheduled jobs nobody has a diagram of.",
      requirements: [
        "Each data flow names the mechanism it uses.",
        "Bespoke extracts carry a reason and an end date.",
        "Extract jobs are registered rather than scheduled privately.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Data Movement",
      name: "Change Data Capture over Full Reload",
      status: "Recommended",
      statement:
        "Where a source supports it, incremental change capture should be preferred to repeated full extracts of a large data set.",
      rationale:
        "Full reloads grow with the data until the window they need is longer than the window they have.",
      requirements: [
        "The extraction approach is stated per source.",
        "Full reloads of large data sets carry a reason.",
        "The load window is shown to fit the available window at projected volume.",
      ],
      owner: "Data Architecture",
    },

    // ---- Lifecycle ---------------------------------------------------
    {
      category: "Data Lifecycle",
      name: "Stated Retention Period",
      status: "Mandatory",
      statement:
        "Every data set must have a retention period derived from its legal, regulatory or business need, stated in the design.",
      rationale:
        "Data kept without a reason is a liability that grows, and it is kept by default unless a period says otherwise.",
      requirements: [
        "A retention period is stated per data set.",
        "The basis for the period is named.",
        "Indefinite retention carries an explicit justification.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Lifecycle",
      name: "Archival Separated from Live Storage",
      status: "Recommended",
      statement:
        "Data retained for compliance but no longer operationally needed should move to archival storage rather than remaining in the live store.",
      rationale:
        "Live stores sized for a decade of history cost more, back up more slowly and recover more slowly than they need to.",
      requirements: [
        "The point at which data becomes archival is stated.",
        "Archival storage and its retrieval time are named.",
        "Archived data remains within its classification controls.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Lifecycle",
      name: "Backup and Recovery Tested",
      status: "Mandatory",
      statement:
        "Designs must state their backup frequency and retention, and must state when recovery from those backups was last tested.",
      rationale:
        "An untested backup is a belief, and the first test of it is always during an incident.",
      requirements: [
        "Backup frequency and retention are stated.",
        "A recovery test interval is stated.",
        "The recovery point and recovery time achieved in test are recorded.",
      ],
      owner: "Data Architecture",
    },
    {
      category: "Data Lifecycle",
      name: "Deletion Reaches Every Copy",
      status: "Mandatory",
      statement:
        "Where a record must be deleted, the design must state how deletion reaches replicas, caches, search indexes, backups and downstream consumers.",
      rationale:
        "Deleting the primary record and leaving six copies is the most common way a deletion obligation is reported as met and is not.",
      requirements: [
        "Every holder of the record is listed.",
        "A deletion path is stated for each.",
        "The timescale for backups to age out is stated.",
      ],
      owner: "Data Governance",
    },
  ],
};
