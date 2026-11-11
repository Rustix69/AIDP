import type { RegisterSource } from "./types";

/**
 * Integration Standards.
 *
 * How systems talk: which pattern, what contract, what happens when the other
 * end is down, and how a change is released without breaking a consumer who
 * deploys on their own schedule. This is the register most likely to produce
 * hard contradictions in a review, because integration choices are the ones a
 * design states most concretely.
 */
export const integration: RegisterSource = {
  key: "integration",
  prefix: "INT",
  title: "Integration Standards",
  scope:
    "Interface style, contracts, resilience, messaging and release practice for communication between systems.",
  rows: [
    // ---- Pattern selection -------------------------------------------
    {
      category: "Pattern Selection",
      name: "Stated Integration Pattern",
      status: "Mandatory",
      statement:
        "Each interaction between systems must name the integration pattern it uses — synchronous request, asynchronous message, event notification or bulk transfer — and why that pattern fits.",
      rationale:
        "The pattern decides the failure behaviour, the coupling and the latency, so a design that leaves it implicit has not decided any of them.",
      requirements: [
        "Each inter-system interaction names its pattern.",
        "The reason the pattern fits the interaction is stated.",
        "Interactions that mix patterns describe the boundary between them.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Pattern Selection",
      name: "Asynchronous by Default for Non-Interactive Work",
      status: "Recommended",
      statement:
        "Work that does not block a user should be carried out asynchronously rather than inside a synchronous call chain.",
      rationale:
        "Synchronous chains make every participant's availability a multiplier on everyone else's, and the arithmetic is unforgiving.",
      requirements: [
        "Non-interactive work is identified.",
        "Synchronous handling of it carries a reason.",
        "The user-facing response does not wait for background work.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Pattern Selection",
      name: "Publish Shared Events Once",
      status: "Mandatory",
      statement:
        "Where more than one system must react to the same business occurrence, it must be published once to a shared event mechanism rather than notified to each consumer individually.",
      rationale:
        "Point-to-point notification means adding a consumer changes the producer, which is the coupling an event mechanism exists to remove.",
      requirements: [
        "Occurrences with multiple consumers are published, not pushed individually.",
        "The producer does not hold a list of its consumers.",
        "Adding a consumer requires no change to the producer.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Pattern Selection",
      name: "No Shared Database Integration",
      status: "Mandatory",
      statement:
        "Systems must not integrate by reading or writing each other's databases, nor by a shared table used as a queue.",
      rationale:
        "It makes one system's internal schema another's public contract, and the contract is discovered only when a routine change breaks something unrelated.",
      requirements: [
        "No cross-system database reads or writes.",
        "No table used as an inter-system queue.",
        "Existing shared-database links carry a migration path.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Pattern Selection",
      name: "Bulk Transfer Bounded",
      status: "Recommended",
      statement:
        "Bulk file transfer should be reserved for genuinely bulk, scheduled movement, and should not be used to carry individual business transactions.",
      rationale:
        "A file of one record arriving every minute is a message queue with worse delivery guarantees and no monitoring.",
      requirements: [
        "Bulk transfers state their volume and schedule.",
        "Transaction-level flows do not use file transfer.",
        "Transfer completion is signalled rather than inferred from a timestamp.",
      ],
      owner: "Integration Architecture",
    },

    // ---- Contracts ----------------------------------------------------
    {
      category: "Interface Contracts",
      name: "Published Interface Contract",
      status: "Mandatory",
      statement:
        "Every interface must have a machine-readable contract that states its operations, payloads, error responses and authentication, published where consumers can find it.",
      rationale:
        "A contract held in a team's head is re-interpreted by every consumer, and the differences surface in production.",
      requirements: [
        "A machine-readable contract exists.",
        "Error responses are specified, not only success responses.",
        "The contract is published to a discoverable location.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interface Contracts",
      name: "Versioned Interfaces",
      status: "Mandatory",
      statement:
        "Interfaces must be versioned, and a breaking change must be released as a new version while the previous one remains available for a stated period.",
      rationale:
        "Consumers deploy on their own schedule; an unversioned breaking change picks that schedule for them.",
      requirements: [
        "The version is expressed in the interface.",
        "Breaking changes increment the version.",
        "A support window for the previous version is stated.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interface Contracts",
      name: "Backward Compatible Changes",
      status: "Mandatory",
      statement:
        "Within a version, changes must be additive; a field must not be removed, renamed or have its meaning or type changed.",
      rationale:
        "Consumers validate against what they were given, and a redefinition inside a version breaks them without changing anything they can see.",
      requirements: [
        "New fields are optional.",
        "Existing fields keep their name, type and meaning.",
        "Deprecated fields are marked rather than removed.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interface Contracts",
      name: "Tolerant Consumers",
      status: "Recommended",
      statement:
        "Consumers should ignore fields they do not recognise rather than failing, so that an additive change to a producer does not become an outage.",
      rationale:
        "Strict consumers turn every compatible producer change into a coordinated release across every team.",
      requirements: [
        "Unknown fields are ignored rather than rejected.",
        "Consumers depend only on the fields they use.",
        "Deserialisation does not fail on an added field.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interface Contracts",
      name: "Consistent Error Semantics",
      status: "Mandatory",
      statement:
        "Interfaces must distinguish a caller error from a server error and from a downstream failure, so a consumer can tell whether retrying is appropriate.",
      rationale:
        "A consumer that cannot tell a bad request from a transient failure either retries what will never succeed or abandons what would have.",
      requirements: [
        "Caller errors and server errors are distinguishable.",
        "Responses indicate whether a retry may succeed.",
        "Error payloads carry a stable code as well as a message.",
      ],
      owner: "Integration Architecture",
    },

    // ---- Resilience ---------------------------------------------------
    {
      category: "Resilience",
      name: "Timeouts on Every Remote Call",
      status: "Mandatory",
      statement:
        "Every outbound call to another system must set an explicit timeout; a design must not rely on a library's default.",
      rationale:
        "A call with no timeout holds a thread or a connection until something else fails, which is how one slow dependency takes down a healthy service.",
      requirements: [
        "Each outbound call states its timeout.",
        "Timeouts are shorter than the caller's own response budget.",
        "Connection and read timeouts are both set.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Resilience",
      name: "Bounded Retries with Backoff",
      status: "Mandatory",
      statement:
        "Retries must be bounded in number, must use exponential backoff with jitter, and must be attempted only for errors that may succeed on a second attempt.",
      rationale:
        "Unbounded synchronised retries convert a brief dependency blip into a sustained overload that prevents its recovery.",
      requirements: [
        "A maximum attempt count is stated.",
        "Backoff is exponential and jittered.",
        "Non-retryable errors are not retried.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Resilience",
      name: "Idempotent Operations",
      status: "Mandatory",
      statement:
        "Any operation that may be retried must be idempotent, so that a repeated delivery does not duplicate a business effect.",
      rationale:
        "At-least-once delivery is what most mechanisms actually provide, so duplicate delivery is a certainty rather than an edge case.",
      requirements: [
        "Retryable operations accept an idempotency key or a natural key.",
        "A repeat produces the same end state as the first attempt.",
        "Duplicate detection is bounded by a stated window.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Resilience",
      name: "Circuit Breaking",
      status: "Recommended",
      statement:
        "Calls to a dependency that is failing should be stopped quickly and resumed gradually, rather than continuing at full rate.",
      rationale:
        "Continuing to call a failing dependency consumes the caller's own capacity and delays the dependency's recovery.",
      requirements: [
        "A failure threshold that opens the breaker is stated.",
        "Behaviour while open is stated.",
        "Recovery is gradual rather than immediate full load.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Resilience",
      name: "Graceful Degradation",
      status: "Mandatory",
      statement:
        "A design must state what the system does when each dependency is unavailable, and must not assume every dependency is always reachable.",
      rationale:
        "Unstated failure behaviour is decided by whatever the code happens to do, which is usually to propagate the failure to the user.",
      requirements: [
        "Each dependency names the behaviour when it is unavailable.",
        "Non-essential dependencies do not fail the primary operation.",
        "The user-visible outcome of degradation is stated.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Resilience",
      name: "No Unbounded Fan-Out",
      status: "Recommended",
      statement:
        "A single inbound request should not trigger an unbounded number of downstream calls; fan-out should be bounded or moved to asynchronous processing.",
      rationale:
        "Fan-out that scales with the data turns a large but legitimate request into a self-inflicted denial of service.",
      requirements: [
        "Downstream call counts per request are bounded.",
        "Collection endpoints are paginated.",
        "Large traversals are handled asynchronously.",
      ],
      owner: "Integration Architecture",
    },

    // ---- Messaging ----------------------------------------------------
    {
      category: "Messaging",
      name: "Durable Messaging",
      status: "Mandatory",
      statement:
        "Messages representing business events or work to be done must be persisted by the broker before acknowledgement, so a broker restart does not lose them.",
      rationale:
        "An in-memory queue is a performance optimisation presented as a delivery guarantee.",
      requirements: [
        "Business messages are persisted before acknowledgement.",
        "The broker's durability configuration is stated.",
        "Replication across failure domains is stated where availability requires it.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Messaging",
      name: "Dead Letter Handling",
      status: "Mandatory",
      statement:
        "Messages that cannot be processed after their retry budget must be moved to a dead letter destination that is monitored and has a named owner.",
      rationale:
        "A poison message with nowhere to go either blocks the queue behind it or is discarded, and both are found out later.",
      requirements: [
        "A dead letter destination exists.",
        "It is monitored and alerts on arrival.",
        "An owner and a reprocessing route are named.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Messaging",
      name: "Message Ordering Stated",
      status: "Mandatory",
      statement:
        "Where processing depends on the order of messages, the design must state how ordering is guaranteed and over what scope.",
      rationale:
        "Most brokers guarantee order only within a partition, and consumers that assume global order are correct until they scale out.",
      requirements: [
        "Order dependence is identified.",
        "The ordering scope is stated.",
        "Consumer scaling preserves the required ordering.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Messaging",
      name: "Self-Describing Events",
      status: "Mandatory",
      statement:
        "Published events must carry a type, a version, a unique identifier and the time the occurrence happened, in addition to their payload.",
      rationale:
        "Without these a consumer cannot deduplicate, cannot order, and cannot tell which schema to apply.",
      requirements: [
        "Each event carries a type and a schema version.",
        "Each event carries a unique identifier.",
        "The occurrence time is distinguished from the publication time.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Messaging",
      name: "Events State Facts, Not Instructions",
      status: "Recommended",
      statement:
        "Published events should describe something that happened rather than instructing a particular consumer to act.",
      rationale:
        "An event that commands a consumer re-couples the producer to it, which removes the benefit of publishing at all.",
      requirements: [
        "Event names describe occurrences in the past tense.",
        "No event names a specific consumer or its action.",
        "Consumers decide their own reaction.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Messaging",
      name: "Bounded Message Size",
      status: "Recommended",
      statement:
        "Messages should carry identifiers and the fields consumers need rather than whole documents; large payloads should be referenced rather than embedded.",
      rationale:
        "Large messages slow every consumer, including the ones that needed three fields out of two hundred.",
      requirements: [
        "A maximum message size is stated.",
        "Large content is referenced rather than embedded.",
        "The reference remains resolvable for the message's lifetime.",
      ],
      owner: "Integration Architecture",
    },

    // ---- Operation ----------------------------------------------------
    {
      category: "Interface Operation",
      name: "Correlation Identifiers",
      status: "Mandatory",
      statement:
        "A correlation identifier must be generated at the entry point and carried through every downstream call and message so a single interaction can be traced end to end.",
      rationale:
        "Without one, diagnosing a distributed failure means guessing which log lines in which systems belong to the same request.",
      requirements: [
        "An identifier is generated at the entry point.",
        "It is propagated across synchronous and asynchronous hops.",
        "It is written into every log entry.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interface Operation",
      name: "Rate Limits Published",
      status: "Mandatory",
      statement:
        "Interfaces must state the request rate they support and what a consumer receives when that rate is exceeded.",
      rationale:
        "An unstated limit is discovered by a consumer in production, usually during their busiest hour.",
      requirements: [
        "A rate limit is stated per consumer.",
        "The response on exceeding it is specified.",
        "A retry hint is returned with the rejection.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interface Operation",
      name: "Interface Monitoring",
      status: "Mandatory",
      statement:
        "Designs must state the availability, latency and error-rate measures held for each interface, and who is alerted when they are breached.",
      rationale:
        "An interface nobody measures is one whose degradation is reported by its consumers rather than detected by its owner.",
      requirements: [
        "Availability, latency and error rate are measured per interface.",
        "Thresholds are stated.",
        "An alert recipient is named.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interface Operation",
      name: "Consumer Registration",
      status: "Recommended",
      statement:
        "Consumers of an interface should be known to its owner, so that the effect of a change or an incident can be assessed.",
      rationale:
        "An owner who cannot list their consumers cannot deprecate anything safely, and cannot tell anyone during an incident.",
      requirements: [
        "Consumers are recorded against the interface.",
        "Each consumer has a contact.",
        "Deprecation notices reach the recorded consumers.",
      ],
      owner: "Integration Architecture",
    },
    {
      category: "Interface Operation",
      name: "Contract Testing",
      status: "Recommended",
      statement:
        "Producers and consumers should verify their contract automatically, so an incompatible change is found in the pipeline rather than in production.",
      rationale:
        "Integration defects are the most expensive class to find late, because they involve two teams and two release schedules.",
      requirements: [
        "Contract tests run in the producer's pipeline.",
        "A failing contract test blocks release.",
        "Consumer expectations are versioned with the contract.",
      ],
      owner: "Integration Architecture",
    },
  ],
};
