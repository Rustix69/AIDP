import type { RegisterSource } from "./types";

/**
 * Solution Architecture Standards.
 *
 * What a single solution must say about itself and how it must be put
 * together: the documentation a review needs to be possible at all, how
 * responsibilities are divided, how state and configuration are handled, and
 * what has to be true before it is operable.
 *
 * The register a design is most often found *silent* on rather than in
 * contradiction with — which is why so many of its rows are about stating
 * something rather than about doing something.
 */
export const solution: RegisterSource = {
  key: "solution",
  prefix: "SOL",
  title: "Solution Architecture Standards",
  scope:
    "Design documentation, decomposition, state, configuration and operability for an individual solution.",
  rows: [
    // ---- Design documentation -----------------------------------------
    {
      category: "Design Documentation",
      name: "Stated Scope and Context",
      status: "Mandatory",
      statement:
        "A design must state the business problem it solves, the systems it interacts with, and what it explicitly does not cover.",
      rationale:
        "A design without a boundary cannot be reviewed, because any omission might be out of scope and nobody can tell which.",
      requirements: [
        "The business problem is stated.",
        "External systems and actors are identified.",
        "Explicit exclusions are listed.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Design Documentation",
      name: "Component View",
      status: "Mandatory",
      statement:
        "A design must show its components, their responsibilities and the connections between them, with each connection naming its protocol and direction.",
      rationale:
        "A diagram of boxes without labelled connections hides exactly the decisions a review exists to examine.",
      requirements: [
        "Components are named with their responsibility.",
        "Connections state protocol and direction.",
        "Trust boundaries are marked.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Design Documentation",
      name: "Data View",
      status: "Mandatory",
      statement:
        "A design must state what data it holds, where it holds it, its classification, and which store is authoritative for each entity.",
      rationale:
        "Most security, privacy and data standards are scoped by what is held where, so a design that does not say cannot be assessed against them.",
      requirements: [
        "Each store is listed with the entities it holds.",
        "Classification is stated per store.",
        "The authoritative store is identified for each entity.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Design Documentation",
      name: "Stated Assumptions and Dependencies",
      status: "Mandatory",
      statement:
        "A design must record the assumptions it relies on and the external dependencies it requires, together with what happens if one does not hold.",
      rationale:
        "An unrecorded assumption is discovered when it fails, by which time the design depends on it in several places.",
      requirements: [
        "Assumptions are listed rather than embedded in prose.",
        "External dependencies are named with their owner.",
        "The consequence of each not holding is stated.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Design Documentation",
      name: "Options Considered",
      status: "Recommended",
      statement:
        "A design should record the main alternatives considered for its significant choices and why they were not taken.",
      rationale:
        "Without the alternatives a reviewer cannot tell a deliberate choice from the first thing that came to mind.",
      requirements: [
        "Significant choices list their alternatives.",
        "The reason for rejection is stated.",
        "Constraints that removed options are named.",
      ],
      owner: "Solution Architecture",
    },

    // ---- Decomposition -------------------------------------------------
    {
      category: "Decomposition",
      name: "Single Responsibility per Component",
      status: "Mandatory",
      statement:
        "Each component must have one clearly stated responsibility; a design must not introduce a component whose description is a list of unrelated functions.",
      rationale:
        "A component with several responsibilities is changed for several unrelated reasons, and each change risks the others.",
      requirements: [
        "Each component's responsibility is stated in one sentence.",
        "No component owns unrelated business capabilities.",
        "Shared utility code is distinguished from business components.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Decomposition",
      name: "Encapsulated Data Ownership",
      status: "Mandatory",
      statement:
        "A component must own its persistent data; two components must not read and write the same tables.",
      rationale:
        "Shared tables make two components one component with a misleading diagram, and neither can be changed independently.",
      requirements: [
        "Each store has one owning component.",
        "Other components reach it through an interface.",
        "Shared read models are identified as derived.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Decomposition",
      name: "Layered Dependencies",
      status: "Mandatory",
      statement:
        "Dependencies between layers must run in one direction; a design must not contain a cycle in which two components depend on each other.",
      rationale:
        "A dependency cycle makes the two components a single unit for release, testing and failure, whatever the diagram says.",
      requirements: [
        "The layering is stated.",
        "No cyclic dependency exists between components.",
        "Inversion is used where a lower layer must notify a higher one.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Decomposition",
      name: "Proportionate Decomposition",
      status: "Recommended",
      statement:
        "The number of independently deployable components should be justified by the need for independent scaling, release or ownership, rather than adopted by default.",
      rationale:
        "Distribution converts local method calls into network calls that can fail, and the cost of that is paid permanently.",
      requirements: [
        "The reason for each deployment boundary is stated.",
        "Components released together are not separated.",
        "The operational cost of the chosen granularity is acknowledged.",
      ],
      owner: "Solution Architecture",
    },

    // ---- State and configuration -----------------------------------------
    {
      category: "State and Configuration",
      name: "Stateless Application Tier",
      status: "Mandatory",
      statement:
        "Application instances must not hold session or request state locally; state must be held in a shared store so any instance can serve any request.",
      rationale:
        "Local state ties a user to an instance, which breaks scaling, rolling deployment and recovery all at once.",
      requirements: [
        "No session state is held in instance memory or local disk.",
        "The shared state store is named.",
        "Losing an instance does not lose a user's session.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "State and Configuration",
      name: "Externalised Configuration",
      status: "Mandatory",
      statement:
        "Environment-specific configuration must be supplied externally at run time; it must not be compiled into the artefact or selected by a build for a named environment.",
      rationale:
        "A per-environment build means the artefact that reaches production is not the artefact that was tested.",
      requirements: [
        "Configuration is supplied at run time.",
        "One artefact serves every environment.",
        "Missing required configuration fails startup loudly.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "State and Configuration",
      name: "No Hard-Coded Endpoints",
      status: "Mandatory",
      statement:
        "Addresses of dependencies must come from configuration or service discovery; host names, IP addresses and connection strings must not be embedded in code.",
      rationale:
        "An embedded address makes a routine infrastructure change a code change, and it is always found at the worst moment.",
      requirements: [
        "Dependency addresses come from configuration or discovery.",
        "No address is embedded in source.",
        "Changing an address requires no rebuild.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "State and Configuration",
      name: "Caching Stated and Bounded",
      status: "Recommended",
      statement:
        "Caches should state what they hold, how long entries live, how they are invalidated, and what staleness consumers will see.",
      rationale:
        "An unbounded cache with no invalidation is a second source of truth that disagrees with the first at unpredictable times.",
      requirements: [
        "Cached data and its lifetime are stated.",
        "An invalidation mechanism is stated.",
        "The maximum staleness a consumer may see is stated.",
      ],
      owner: "Solution Architecture",
    },

    // ---- Behaviour -------------------------------------------------------
    {
      category: "Behaviour",
      name: "Transaction Boundaries",
      status: "Mandatory",
      statement:
        "A design must state its transaction boundaries, and where an operation spans systems it must state how partial failure is resolved.",
      rationale:
        "An operation that updates two systems without a stated compensation leaves them inconsistent and nobody responsible for noticing.",
      requirements: [
        "Transaction boundaries are stated.",
        "Cross-system operations state their compensation or reconciliation.",
        "The window of inconsistency is stated.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Behaviour",
      name: "Concurrency Control",
      status: "Mandatory",
      statement:
        "Where records can be updated concurrently, the design must state how conflicting updates are detected and resolved.",
      rationale:
        "Unmanaged concurrent updates lose data silently, and the loss is attributed to the user who reported it.",
      requirements: [
        "Concurrently updatable records are identified.",
        "A detection mechanism is stated.",
        "The resolution behaviour is stated.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Behaviour",
      name: "Bounded Result Sets",
      status: "Mandatory",
      statement:
        "Operations returning collections must be paginated or otherwise bounded; a design must not return an unbounded set whose size grows with the data.",
      rationale:
        "An unbounded query is correct in test with a thousand rows and an outage in production with ten million.",
      requirements: [
        "Collection responses are paginated.",
        "A maximum page size is enforced server-side.",
        "Exports of large data sets use a separate asynchronous route.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Behaviour",
      name: "Audit of Business-Significant Actions",
      status: "Mandatory",
      statement:
        "Actions that change business-significant records must be recorded with the acting identity, the time, and what changed.",
      rationale:
        "A record whose history cannot be reconstructed cannot be defended when it is challenged.",
      requirements: [
        "Business-significant actions are identified.",
        "Each audit entry carries actor, time and change.",
        "The audit record cannot be amended by the application that writes it.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Behaviour",
      name: "Background Work Observable",
      status: "Recommended",
      statement:
        "Scheduled and background work should report whether it ran, whether it succeeded, and how long it took.",
      rationale:
        "A scheduled job that silently stops running is usually discovered by the absence of its output, weeks later.",
      requirements: [
        "Each job reports start, outcome and duration.",
        "A missed run raises an alert.",
        "Jobs are not scheduled on a single host without redundancy.",
      ],
      owner: "Solution Architecture",
    },

    // ---- Operability -----------------------------------------------------
    {
      category: "Operability",
      name: "Named Service Owner",
      status: "Mandatory",
      statement:
        "A design must name the team accountable for operating the solution after release, and the support model that applies.",
      rationale:
        "A system handed over to nobody in particular is operated by whoever is available during its first incident.",
      requirements: [
        "An owning team is named.",
        "The support model and hours are stated.",
        "An escalation path is stated.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Operability",
      name: "Runbook for Known Failures",
      status: "Mandatory",
      statement:
        "A design must provide a runbook covering its known failure modes, the alerts it raises and the expected response to each.",
      rationale:
        "An alert with no documented response is answered by improvisation at the worst possible time.",
      requirements: [
        "Known failure modes are listed.",
        "Each alert references a response.",
        "The runbook is reachable by the people on call.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Operability",
      name: "Automated Testing Before Release",
      status: "Mandatory",
      statement:
        "A design must state the automated tests that gate its release and what they cover.",
      rationale:
        "A release gated only by manual testing is gated by how much time remained after development.",
      requirements: [
        "The test levels in the pipeline are stated.",
        "A failing test blocks release.",
        "Coverage of the critical paths is stated.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Operability",
      name: "Performance Validated Against Target",
      status: "Recommended",
      statement:
        "Designs with a stated performance target should be tested against it at projected peak load before first release.",
      rationale:
        "Performance targets that are never tested are aspirations, and the first test is the first peak.",
      requirements: [
        "A performance test at projected peak is planned.",
        "The test environment's relationship to production is stated.",
        "Results are recorded against the stated target.",
      ],
      owner: "Solution Architecture",
    },
    {
      category: "Operability",
      name: "Accessibility of User Interfaces",
      status: "Recommended",
      statement:
        "User interfaces should meet the organisation's accessibility standard, and the design should state which level applies.",
      rationale:
        "Accessibility retrofitted after release costs several times what it costs to design in, and may be a legal obligation.",
      requirements: [
        "The accessibility standard and level are stated.",
        "Testing against it is planned.",
        "Known exceptions are recorded.",
      ],
      owner: "Solution Architecture",
    },
  ],
};
