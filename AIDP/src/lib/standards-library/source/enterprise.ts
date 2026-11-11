import type { RegisterSource } from "./types";

/**
 * Enterprise Architecture Standards.
 *
 * The register that constrains the *shape* of the estate rather than the
 * inside of any one system: what may be built at all, what it must reuse, and
 * what it must not duplicate. Deliberately the smallest of the six — an
 * enterprise register that runs to a hundred rows has stopped being principles
 * and started being a design.
 */
export const enterprise: RegisterSource = {
  key: "enterprise",
  prefix: "EA",
  title: "Enterprise Architecture Standards",
  scope:
    "Estate-level principles governing reuse, capability ownership, technology selection and architectural change.",
  rows: [
    {
      category: "Architecture Governance",
      name: "Architecture Review Before Build",
      status: "Mandatory",
      statement:
        "A solution introducing a new system, a new integration pattern or a new technology must be reviewed against this framework before implementation begins.",
      rationale:
        "The cost of changing an architectural decision rises steeply once code and data depend on it, so review after build is a report rather than a control.",
      requirements: [
        "The design is submitted before implementation starts.",
        "New technologies and new integration patterns are called out explicitly.",
        "Deviations carry a recorded decision rather than being left unstated.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Architecture Governance",
      name: "Recorded Architectural Decisions",
      status: "Mandatory",
      statement:
        "Decisions that are costly to reverse must be recorded with the options considered, the choice made and the reason, and must be referenced from the design.",
      rationale:
        "An undocumented decision is re-argued every time someone new arrives, and is re-made differently when the person who made it leaves.",
      requirements: [
        "Each significant decision names the options considered.",
        "The chosen option carries its reason, not only its name.",
        "The record is referenced from the design rather than held privately.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Architecture Governance",
      name: "Deviation by Exception",
      status: "Mandatory",
      statement:
        "A design that does not meet a Mandatory standard must record the deviation, its risk, its compensating control and an accountable owner; it must not simply omit the standard.",
      rationale:
        "A stated deviation is a managed risk; a silent one is an unmanaged risk that nobody knows they are carrying.",
      requirements: [
        "Each deviation names the standard it departs from.",
        "A compensating control is stated.",
        "An accountable owner and a review date are recorded.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Capability and Reuse",
      name: "Reuse Before Build",
      status: "Mandatory",
      statement:
        "A design must reuse an existing enterprise capability where one meets the need; building a second implementation of an owned capability requires a recorded exception.",
      rationale:
        "Every duplicate capability doubles the places a rule has to be changed and halves the chance they stay in step.",
      requirements: [
        "The design states which existing capabilities it reuses.",
        "Where a capability is rebuilt, the shortfall in the existing one is named.",
        "The duplicate's retirement path is stated.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Capability and Reuse",
      name: "Single Owner per Capability",
      status: "Mandatory",
      statement:
        "Each business capability must have one owning system of record; a design must not introduce a second authoritative source for data an existing system already owns.",
      rationale:
        "Two authoritative sources for one fact produce disagreement that no reconciliation process can fully resolve.",
      requirements: [
        "The owning system is named for each capability the design touches.",
        "No new store becomes authoritative for data another system owns.",
        "Copies held for performance are identified as copies.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Capability and Reuse",
      name: "Buy, Configure, then Build",
      status: "Recommended",
      statement:
        "Where a capability is not differentiating, a design should prefer a supported product configured to the need over bespoke development.",
      rationale:
        "Bespoke code for a commodity capability is paid for once in delivery and repeatedly in maintenance, upgrades and recruitment.",
      requirements: [
        "The build-or-buy position is stated for each major component.",
        "Bespoke development of a commodity capability carries a reason.",
        "Product selection records the alternatives considered.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Technology Selection",
      name: "Approved Technology",
      status: "Mandatory",
      statement:
        "Designs must use technologies the organisation has approved; a technology recorded as on hold must not be introduced, and one absent from the approved stack requires assessment before adoption.",
      rationale:
        "An unapproved technology arrives with no support position, no patching route and no one able to operate it at three in the morning.",
      requirements: [
        "Every technology in the design appears in the approved technology stack.",
        "No technology recorded as on hold is introduced.",
        "A technology absent from the stack is submitted for assessment before use.",
      ],
      owner: "Enterprise Architecture",
      notes: "Assessed against the organisation's technology stack rather than against this register's own rows.",
    },
    {
      category: "Technology Selection",
      name: "Supported Versions",
      status: "Mandatory",
      statement:
        "Designs must name the version of each significant technology they use, and that version must fall within the range the organisation has approved.",
      rationale:
        "A technology approved in principle and deployed at an unsupported version carries the risk the approval was meant to remove.",
      requirements: [
        "Each significant technology carries its version.",
        "The version falls inside the approved range.",
        "An upgrade path is stated where it does not.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Technology Selection",
      name: "Avoid Unnecessary Diversity",
      status: "Recommended",
      statement:
        "A design should not introduce a second technology that performs a function an already-approved technology performs adequately.",
      rationale:
        "Each additional technology is a separate skill set, patching cycle, support contract and failure mode, paid for permanently.",
      requirements: [
        "New technologies are compared against approved ones already doing the job.",
        "The additional operational cost is acknowledged.",
        "Where diversity is accepted, the boundary between the two is stated.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Interoperability",
      name: "Standard Interfaces",
      status: "Mandatory",
      statement:
        "Systems must expose their capabilities through documented, versioned interfaces; another system must not reach into a system's database to obtain its data.",
      rationale:
        "A direct database dependency makes one system's internal schema another system's public contract, and it is discovered only when a routine change breaks something unrelated.",
      requirements: [
        "Each inter-system dependency names the interface it uses.",
        "No system reads or writes another system's database directly.",
        "Interfaces are documented and versioned.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interoperability",
      name: "Common Enterprise Vocabulary",
      status: "Recommended",
      statement:
        "Interfaces should use the enterprise's agreed names and definitions for shared business entities rather than terms local to one system.",
      rationale:
        "Shared entities named differently in each system is the cause of most reconciliation work and most reporting disputes.",
      requirements: [
        "Shared entities use the enterprise definition.",
        "Local terms are mapped to enterprise terms at the boundary.",
        "New shared entities are proposed to the data governance function.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Lifecycle",
      name: "Decommissioning Plan",
      status: "Mandatory",
      statement:
        "A design that replaces an existing system must state when and how the replaced system is decommissioned, including its data and its integrations.",
      rationale:
        "A replacement without a decommissioning plan leaves two systems running permanently, which is more expensive than the one it was meant to replace.",
      requirements: [
        "The replaced system is named with a decommissioning date.",
        "The fate of its data is stated.",
        "Its remaining integrations are listed with their migration.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Lifecycle",
      name: "No Permanent Transitional State",
      status: "Recommended",
      statement:
        "Where a design passes through a transitional architecture, it should state how long that state lasts and what ends it.",
      rationale:
        "Transitional architectures that are not given an end date become the architecture, with none of the review a permanent design would have received.",
      requirements: [
        "The transitional state is identified as transitional.",
        "An end condition is stated.",
        "The cost of remaining in it is acknowledged.",
      ],
      owner: "Enterprise Architecture",
    },
    {
      category: "Lifecycle",
      name: "Non-Functional Requirements Stated",
      status: "Mandatory",
      statement:
        "A design must state its availability, performance, capacity and recovery targets; these must be numbers rather than adjectives.",
      rationale:
        "A target expressed as 'highly available' cannot be designed for, tested against or breached, so it constrains nothing.",
      requirements: [
        "Availability is stated as a figure.",
        "Expected and peak load are stated.",
        "Recovery time and recovery point objectives are stated.",
      ],
      owner: "Enterprise Architecture",
    },
  ],
};
