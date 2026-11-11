import type { RegisterSource } from "./types";

/**
 * Infrastructure Standards.
 *
 * Where a system runs, how it gets there, how it survives a failure and how it
 * is observed. Network controls live in the Security register — this one is
 * about provisioning, availability and operability.
 */
export const infrastructure: RegisterSource = {
  key: "infrastructure",
  prefix: "INF",
  title: "Infrastructure Standards",
  scope:
    "Hosting, provisioning, availability, recovery and observability of deployed systems.",
  rows: [
    // ---- Provisioning -------------------------------------------------
    {
      category: "Provisioning",
      name: "Infrastructure as Code",
      status: "Mandatory",
      statement:
        "Infrastructure must be defined in version-controlled code and provisioned from it; production infrastructure must not be created or changed by hand through a console.",
      rationale:
        "Hand-built infrastructure cannot be reviewed, reproduced after a loss, or compared against what was approved.",
      requirements: [
        "Infrastructure definitions are held in version control.",
        "Production changes are applied through the pipeline.",
        "Manual changes are detected and reconciled.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Provisioning",
      name: "Reproducible Environments",
      status: "Mandatory",
      statement:
        "Every environment must be built from the same definitions, with differences expressed as configuration rather than as separate implementations.",
      rationale:
        "Environments that diverge in structure make testing a statement about the test environment rather than about production.",
      requirements: [
        "Environments share one set of definitions.",
        "Differences are expressed as parameters.",
        "The differences between non-production and production are listed.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Provisioning",
      name: "Immutable Deployment Artefacts",
      status: "Mandatory",
      statement:
        "The artefact tested must be the artefact deployed; a running instance must not be patched in place to change its application code.",
      rationale:
        "Patching in place means the deployed system diverges from the one that passed testing, invisibly and irreversibly.",
      requirements: [
        "One artefact is promoted across environments.",
        "The artefact is identified by an immutable version or digest.",
        "Instances are replaced rather than modified.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Provisioning",
      name: "Resource Tagging",
      status: "Recommended",
      statement:
        "Provisioned resources should carry tags identifying their owner, environment, cost centre and data classification.",
      rationale:
        "Untagged resources cannot be attributed, budgeted, or safely deleted, so they are kept indefinitely.",
      requirements: [
        "A mandatory tag set is defined.",
        "Tags are applied at provisioning time.",
        "Untagged resources are reported.",
      ],
      owner: "Platform Engineering",
    },

    // ---- Availability --------------------------------------------------
    {
      category: "Availability",
      name: "Stated Availability Target",
      status: "Mandatory",
      statement:
        "A design must state its availability target as a figure, together with the business impact of not meeting it.",
      rationale:
        "Availability drives almost every infrastructure cost in a design, so a target expressed as an adjective leaves the cost undecided too.",
      requirements: [
        "Availability is stated as a percentage or an allowed downtime.",
        "The measurement window is stated.",
        "The business impact of a breach is stated.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Availability",
      name: "No Single Point of Failure",
      status: "Mandatory",
      statement:
        "Components serving an availability target above a single instance's capability must be deployed redundantly across failure domains.",
      rationale:
        "A redundant application tier in front of a single database is a single point of failure with extra steps.",
      requirements: [
        "Each tier states its redundancy.",
        "Redundant instances sit in different failure domains.",
        "Shared dependencies are identified as shared.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Availability",
      name: "Health Checks and Automated Recovery",
      status: "Mandatory",
      statement:
        "Services must expose a health check that reflects their ability to serve traffic, and unhealthy instances must be removed and replaced automatically.",
      rationale:
        "A health check that returns success whenever the process is running keeps routing traffic to an instance that cannot serve it.",
      requirements: [
        "A health check endpoint is exposed.",
        "It reflects dependency readiness, not just process liveness.",
        "Unhealthy instances are removed from rotation automatically.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Availability",
      name: "Capacity Planning",
      status: "Mandatory",
      statement:
        "Designs must state expected and peak load, the resources provisioned for them, and the headroom between the two.",
      rationale:
        "Capacity assumed rather than calculated is discovered at the first peak, which is usually the one that mattered.",
      requirements: [
        "Expected and peak load are stated.",
        "Provisioned capacity is stated against them.",
        "Growth over the planning horizon is accounted for.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Availability",
      name: "Elastic Scaling",
      status: "Recommended",
      statement:
        "Workloads with variable demand should scale automatically, with stated minimum and maximum bounds.",
      rationale:
        "Fixed capacity sized for the peak is idle most of the time and still insufficient during the peak that was not forecast.",
      requirements: [
        "Scaling triggers are stated.",
        "Minimum and maximum bounds are set.",
        "The maximum is reconciled against downstream dependency limits.",
      ],
      owner: "Platform Engineering",
    },

    // ---- Continuity ------------------------------------------------------
    {
      category: "Continuity",
      name: "Recovery Objectives Stated",
      status: "Mandatory",
      statement:
        "Designs must state a recovery time objective and a recovery point objective, derived from the business impact of loss.",
      rationale:
        "These two numbers determine the entire continuity design, and in their absence it is chosen by whatever the platform does by default.",
      requirements: [
        "A recovery time objective is stated.",
        "A recovery point objective is stated.",
        "Both are traced to a business impact rather than chosen by habit.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Continuity",
      name: "Tested Recovery",
      status: "Mandatory",
      statement:
        "The recovery procedure must be tested at a stated interval, and the result must be recorded against the stated objectives.",
      rationale:
        "An untested recovery procedure is a document, and the gap between the document and reality is found only during an incident.",
      requirements: [
        "A test interval is stated.",
        "The test exercises recovery rather than only backup.",
        "Achieved recovery time and point are recorded.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Continuity",
      name: "Geographic Separation",
      status: "Recommended",
      statement:
        "Systems whose recovery objectives cannot tolerate the loss of a site should hold their recovery capability in a separate geography.",
      rationale:
        "Two copies in one facility share one flood, one power event and one network partition.",
      requirements: [
        "The recovery location is stated.",
        "It does not share a failure domain with the primary.",
        "Data replication to it meets the recovery point objective.",
      ],
      owner: "Platform Engineering",
    },

    // ---- Observability ---------------------------------------------------
    {
      category: "Observability",
      name: "Structured Logging",
      status: "Mandatory",
      statement:
        "Applications must emit structured logs to a central platform, including a correlation identifier and the environment they came from.",
      rationale:
        "Unstructured logs scattered across hosts can be read but not queried, which is the difference between evidence and archaeology.",
      requirements: [
        "Logs are structured rather than free text.",
        "Each entry carries a correlation identifier.",
        "Logs are shipped to a central platform.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Observability",
      name: "Service Metrics",
      status: "Mandatory",
      statement:
        "Services must publish request rate, error rate, latency and saturation metrics, and these must be retained long enough to show a trend.",
      rationale:
        "Without these four a service can only be observed as up or down, which is not enough to act before it goes down.",
      requirements: [
        "Request rate, error rate and latency are published.",
        "A saturation measure is published.",
        "Retention is long enough to compare against the previous period.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Observability",
      name: "Actionable Alerting",
      status: "Mandatory",
      statement:
        "Alerts must indicate a condition requiring human action, must reach a named recipient, and must reference a documented response.",
      rationale:
        "Alerts that fire without requiring action train their recipients to ignore the ones that do.",
      requirements: [
        "Each alert states the condition and its threshold.",
        "A recipient is named.",
        "A documented response is referenced.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Observability",
      name: "Distributed Tracing",
      status: "Recommended",
      statement:
        "Systems spanning several services should emit distributed traces so the latency of an interaction can be attributed to a component.",
      rationale:
        "In a distributed system, per-service metrics show that something is slow but not which hop caused it.",
      requirements: [
        "Trace context is propagated across service boundaries.",
        "Spans are emitted for outbound calls.",
        "A sampling strategy is stated.",
      ],
      owner: "Platform Engineering",
    },

    // ---- Change ----------------------------------------------------------
    {
      category: "Change and Release",
      name: "Automated Deployment",
      status: "Mandatory",
      statement:
        "Deployment to production must be carried out by an automated pipeline with a recorded approval, not by manual steps on a host.",
      rationale:
        "Manual deployment is unrepeatable, unauditable, and reliably different at three in the morning.",
      requirements: [
        "Deployment is pipeline-driven.",
        "The approval and the approver are recorded.",
        "The pipeline is the only route to production.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Change and Release",
      name: "Rollback Path",
      status: "Mandatory",
      statement:
        "Every release must have a stated way back, and where a release includes a schema change that way back must be tested.",
      rationale:
        "A release whose only recovery is to roll forward turns a failed deployment into an unplanned development task under pressure.",
      requirements: [
        "A rollback mechanism is stated.",
        "Schema changes are backward compatible for one release.",
        "The rollback has been exercised, not only described.",
      ],
      owner: "Platform Engineering",
    },
    {
      category: "Change and Release",
      name: "Progressive Rollout",
      status: "Recommended",
      statement:
        "Significant changes should reach production gradually, with an automated measure that halts the rollout on degradation.",
      rationale:
        "Releasing to everybody at once means the blast radius of a defect is the whole user base.",
      requirements: [
        "A rollout strategy is stated.",
        "A health measure gates progression.",
        "Rollout halts automatically on degradation.",
      ],
      owner: "Platform Engineering",
    },
  ],
};
