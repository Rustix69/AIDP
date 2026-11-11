import type { RegisterSource } from "./types";

/**
 * Security Standards — the baseline library's security register.
 *
 * Scoped to what an architecture review can actually see in a design document:
 * how identity is established, where data sits and in what state, what crosses
 * a trust boundary, and what is recorded afterwards. Deliberately **not** an
 * operational security policy — "staff complete annual awareness training" is a
 * real control and an unassessable clause, because no solution design will ever
 * contradict it, and a register full of rows nothing can breach teaches the
 * engine that silence means compliance.
 */
export const security: RegisterSource = {
  key: "security",
  prefix: "SEC",
  title: "Security Standards",
  scope:
    "Identity, data protection, network and application security controls that a solution design can be measured against.",
  rows: [
    // ---- Identity and Access -------------------------------------------
    {
      category: "Identity and Access",
      name: "Authenticated Access",
      status: "Mandatory",
      statement:
        "Every interface that exposes business data or triggers a business action must authenticate the caller; anonymous access is permitted only for content that is public by classification.",
      rationale:
        "An unauthenticated interface cannot be authorised, logged against a subject, or revoked, so every control that follows depends on this one.",
      requirements: [
        "Every externally reachable endpoint is listed with the authentication method it enforces.",
        "Any endpoint left anonymous names the classification that makes its content public.",
        "Health and metrics endpoints do not return business data to an unauthenticated caller.",
      ],
      owner: "Security Architecture",
    },
    {
      category: "Identity and Access",
      name: "Central Identity Provider",
      status: "Mandatory",
      statement:
        "Human authentication must be delegated to the enterprise identity provider using a federation protocol; applications must not maintain their own username and password store.",
      rationale:
        "Local credential stores survive an employee leaving, multiply the places a password reset has to reach, and cannot enforce a central session or MFA policy.",
      requirements: [
        "The federation protocol and the identity provider are named.",
        "No application-local table of user passwords is present in the data model.",
        "Any local account that remains is a break-glass account with a stated review cycle.",
      ],
      owner: "Identity and Access Management",
    },
    {
      category: "Identity and Access",
      name: "Multi-Factor Authentication",
      status: "Mandatory",
      statement:
        "Interactive access to systems handling Confidential or Restricted data, and all administrative access regardless of classification, must require a second authentication factor.",
      rationale:
        "A single factor is a single disclosure away from account takeover, and credential reuse makes that disclosure likely rather than theoretical.",
      requirements: [
        "The design states which roles are subject to a second factor.",
        "Administrative paths require a second factor even where the data is Internal or Public.",
        "Any exemption names the compensating control and who accepted the risk.",
      ],
      owner: "Identity and Access Management",
    },
    {
      category: "Identity and Access",
      name: "Service Identity",
      status: "Mandatory",
      statement:
        "Service-to-service calls must authenticate with a workload identity issued to the calling service; a service must not call another service using a human user's credentials.",
      rationale:
        "Borrowing a person's identity makes an audit trail unreadable and leaves the service broken the day that person leaves.",
      requirements: [
        "Each service-to-service call names the workload identity that makes it.",
        "No shared account is used by more than one service.",
        "The credential issued to a workload is short-lived or rotated on a stated interval.",
      ],
      owner: "Security Architecture",
    },
    {
      category: "Identity and Access",
      name: "Least Privilege",
      status: "Mandatory",
      statement:
        "Every identity must be granted the narrowest set of permissions its function requires; wildcard administrative grants must not be used to satisfy a functional requirement.",
      rationale:
        "The reach of a compromised identity is decided entirely in advance, by what it was allowed to do before anyone knew it was compromised.",
      requirements: [
        "Each identity in the design has its permissions stated, not implied.",
        "No role carries a wildcard grant over a data store or a cloud subscription.",
        "Read-only consumers hold read-only permissions.",
      ],
      owner: "Security Architecture",
    },
    {
      category: "Identity and Access",
      name: "Authorisation at the Server",
      status: "Mandatory",
      statement:
        "Authorisation decisions must be enforced server-side on every request; hiding a control in the user interface must not be the only thing preventing an action.",
      rationale:
        "A client is under the caller's control, so a check that only runs there is advice rather than a control.",
      requirements: [
        "Each protected operation names where its authorisation check runs.",
        "Object-level access is checked against the caller, not only the operation type.",
        "No control relies solely on a hidden or disabled element in the interface.",
      ],
      owner: "Application Security",
    },
    {
      category: "Identity and Access",
      name: "Privileged Access Control",
      status: "Mandatory",
      statement:
        "Privileged and break-glass accounts must be issued on request for a bounded period, record the reason for use, and be reviewed at least quarterly.",
      rationale:
        "Standing administrative access is the shortest path between a routine phishing email and a total compromise.",
      requirements: [
        "Privileged access is time-bounded rather than standing.",
        "Each use records the requester and the reason.",
        "A review cycle of at most three months is stated.",
      ],
      owner: "Identity and Access Management",
      notes: "Covers production infrastructure, database superuser and cloud root or tenant-owner roles.",
    },
    {
      category: "Identity and Access",
      name: "Access Revocation",
      status: "Mandatory",
      statement:
        "Access must be withdrawn when the role that justified it ends, and the design must state which directory event or joiner-mover-leaver process triggers that withdrawal.",
      rationale:
        "Access that outlives its reason is indistinguishable from access that was never authorised.",
      requirements: [
        "The triggering event for revocation is named.",
        "Revocation reaches application-level permissions, not only the directory account.",
        "Service credentials held by a leaver's personal identity are rotated.",
      ],
      owner: "Identity and Access Management",
    },
    {
      category: "Identity and Access",
      name: "Session Expiry",
      status: "Recommended",
      statement:
        "Interactive sessions should expire after a defined period of inactivity and should be re-authenticated before a privileged action is carried out.",
      rationale:
        "An unattended authenticated session is an open door that requires no attack to walk through.",
      requirements: [
        "An inactivity timeout is stated.",
        "An absolute session lifetime is stated.",
        "Privileged actions prompt for re-authentication.",
      ],
      owner: "Application Security",
    },

    // ---- Secrets and Key Management -------------------------------------
    {
      category: "Secrets and Key Management",
      name: "No Secrets in Source",
      status: "Mandatory",
      statement:
        "Credentials, API keys, tokens and private keys must not be committed to source control, embedded in container images, or written into configuration files distributed with the application.",
      rationale:
        "A secret in a repository is disclosed to everyone who can read the repository and stays disclosed in its history after it is deleted.",
      requirements: [
        "No credential appears in source, image layers or shipped configuration.",
        "Configuration carries a reference to a secret rather than its value.",
        "Secret scanning runs over the repository and its history.",
      ],
      owner: "Application Security",
    },
    {
      category: "Secrets and Key Management",
      name: "Managed Secret Store",
      status: "Mandatory",
      statement:
        "Secrets must be held in a managed secret store and retrieved at run time by an authenticated workload identity.",
      rationale:
        "A central store is the only place a secret can be rotated, audited and revoked once rather than everywhere it was copied to.",
      requirements: [
        "The secret store is named.",
        "Retrieval is authenticated by workload identity rather than by a bootstrap password.",
        "Access to each secret is scoped to the services that need it.",
      ],
      owner: "Security Architecture",
    },
    {
      category: "Secrets and Key Management",
      name: "Key and Credential Rotation",
      status: "Mandatory",
      statement:
        "Encryption keys and long-lived credentials must be rotatable without a service outage, and the design must state the rotation interval and the mechanism.",
      rationale:
        "A key that cannot be rotated without downtime is a key that will not be rotated, including after it is known to have leaked.",
      requirements: [
        "A rotation interval is stated for each key and long-lived credential.",
        "Rotation does not require a service restart or a release.",
        "Two key versions can be valid at once so rotation is not a cutover.",
      ],
      owner: "Security Architecture",
    },
    {
      category: "Secrets and Key Management",
      name: "Customer-Managed Keys",
      status: "Recommended",
      statement:
        "Systems holding Restricted data should encrypt it with customer-managed keys rather than provider-managed defaults.",
      rationale:
        "Holding the key is what makes deletion, revocation and jurisdictional assurance something the organisation can carry out itself.",
      requirements: [
        "Stores holding Restricted data name their key management arrangement.",
        "Key material is held in a hardware-backed or managed key service.",
        "Revoking the key renders the data unreadable without erasing the store.",
      ],
      owner: "Security Architecture",
    },

    // ---- Data Protection -------------------------------------------------
    {
      category: "Data Protection",
      name: "Encryption in Transit",
      status: "Mandatory",
      statement:
        "All network traffic carrying business data must be encrypted with TLS 1.2 or later, including traffic that stays inside the corporate network or a single cloud tenancy.",
      rationale:
        "The internal network is not a trust boundary; lateral movement is the normal second step of an intrusion, not an unusual one.",
      requirements: [
        "Every connection in the design states its transport protection.",
        "TLS 1.0 and 1.1 are not offered.",
        "Internal and service-to-service traffic is encrypted, not only internet-facing traffic.",
      ],
      owner: "Security Architecture",
    },
    {
      category: "Data Protection",
      name: "Encryption at Rest",
      status: "Mandatory",
      statement:
        "Persistent stores holding Internal, Confidential or Restricted data must be encrypted at rest, including databases, object storage, message queues, search indexes, caches and backups.",
      rationale:
        "Encryption applied only to the primary database leaves the same records readable in the replica, the backup and the search index.",
      requirements: [
        "Every persistent store in the design states whether it is encrypted at rest.",
        "Backups, replicas and snapshots are encrypted to the same standard as the primary.",
        "Derived stores such as search indexes and caches are included.",
      ],
      owner: "Security Architecture",
      notes: "Backups and non-production copies are the most commonly missed of these.",
    },
    {
      category: "Data Protection",
      name: "Data Classification",
      status: "Mandatory",
      statement:
        "Every data store and interface in a design must state the highest classification of data it holds or carries.",
      rationale:
        "Almost every control in this register is scoped by classification, so an unclassified store cannot be reviewed at all.",
      requirements: [
        "Each store names its highest classification.",
        "Each interface names the classification of the data it carries.",
        "Where classifications are mixed, the design says how they are kept apart.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Protection",
      name: "Non-Production Data",
      status: "Mandatory",
      statement:
        "Production data classified Confidential or Restricted must not be copied into development, test or demonstration environments without masking, tokenisation or synthesis.",
      rationale:
        "Lower environments carry weaker controls and wider access by design, so a copy made there is a classification downgrade nobody approved.",
      requirements: [
        "The design states what data non-production environments hold.",
        "Any production-derived data is masked, tokenised or synthetic.",
        "The masking is irreversible without access to a separately controlled key.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Protection",
      name: "Minimum Necessary Data",
      status: "Mandatory",
      statement:
        "An interface must return only the fields the consumer needs; a design must not expose a whole record where a subset satisfies the requirement.",
      rationale:
        "Over-exposure is what turns a minor authorisation flaw into a reportable disclosure.",
      requirements: [
        "Each interface names the fields it returns.",
        "No interface returns an entire entity where the consumer needs part of it.",
        "Identifiers exposed externally are not themselves sensitive values.",
      ],
      owner: "Data Governance",
    },
    {
      category: "Data Protection",
      name: "Personal Data Residency",
      status: "Mandatory",
      statement:
        "Designs processing personal data must state the jurisdictions in which that data is stored and processed, including the location of backups and of any third-party processor.",
      rationale:
        "Residency is a statutory constraint rather than a preference, and it is usually broken by a backup or a support tool rather than by the primary store.",
      requirements: [
        "The storage and processing regions are named.",
        "Backup and disaster-recovery regions are named.",
        "Any third-party processor and its region is named.",
      ],
      owner: "Data Protection Officer",
    },
    {
      category: "Data Protection",
      name: "Retention and Secure Disposal",
      status: "Recommended",
      statement:
        "Designs should state the retention period for each data set and how data is destroyed at the end of it, including copies held in backups, archives and downstream caches.",
      rationale:
        "Retention limits that are never enforced leave the organisation holding records it has told people it deleted.",
      requirements: [
        "Each data set states a retention period.",
        "A mechanism enforces the period rather than relying on manual deletion.",
        "Deletion reaches backups and downstream copies on a stated timescale.",
      ],
      owner: "Data Governance",
    },

    // ---- Network Security ------------------------------------------------
    {
      category: "Network Security",
      name: "Deny by Default",
      status: "Mandatory",
      statement:
        "Network access controls must deny by default and permit only the flows the design names, by source, destination and port.",
      rationale:
        "A permissive default means the controls describe what somebody remembered to block rather than what the system needs.",
      requirements: [
        "The design lists the permitted flows.",
        "No rule permits traffic from any source to any destination.",
        "Outbound traffic is constrained as well as inbound.",
      ],
      owner: "Network Security",
    },
    {
      category: "Network Security",
      name: "No Direct Internet Exposure of Data Stores",
      status: "Mandatory",
      statement:
        "Databases, message brokers, caches and object stores must not be directly reachable from the public internet; access must be mediated by an application or a controlled gateway.",
      rationale:
        "Directly exposed data stores are found by routine internet-wide scanning within hours, not by a targeted attacker.",
      requirements: [
        "No data store carries a public endpoint.",
        "Object storage containers are private unless the content is Public by classification.",
        "Administrative interfaces are reachable only from a controlled network.",
      ],
      owner: "Network Security",
    },
    {
      category: "Network Security",
      name: "Managed Ingress",
      status: "Mandatory",
      statement:
        "Internet-facing entry points must pass through a managed ingress providing TLS termination, request filtering and rate limiting before reaching application code.",
      rationale:
        "Volumetric and malformed-request handling belongs in front of the application, where it protects every service behind it at once.",
      requirements: [
        "Each internet-facing entry point names its ingress component.",
        "Rate limiting is applied at the edge.",
        "Application instances do not accept traffic that bypasses the ingress.",
      ],
      owner: "Network Security",
    },
    {
      category: "Network Security",
      name: "Environment Segregation",
      status: "Mandatory",
      statement:
        "Production must be network-isolated from non-production, and a non-production workload must not hold credentials that grant access to production.",
      rationale:
        "A shared path between environments makes the weakest environment's controls the organisation's real controls.",
      requirements: [
        "Production and non-production sit in separate network boundaries.",
        "No non-production credential grants production access.",
        "Shared services used by both state how they keep the two apart.",
      ],
      owner: "Network Security",
    },
    {
      category: "Network Security",
      name: "Private Connectivity to Managed Services",
      status: "Recommended",
      statement:
        "Traffic to managed cloud services should use private connectivity rather than traversing the public internet, even where that traffic is encrypted.",
      rationale:
        "Keeping the path private removes exposure of endpoints and reduces reliance on credentials as the only control.",
      requirements: [
        "Managed service connections state whether they are private.",
        "Public endpoints on managed services are disabled where private access is in use.",
        "Name resolution for private endpoints is stated.",
      ],
      owner: "Network Security",
    },

    // ---- Application Security --------------------------------------------
    {
      category: "Application Security",
      name: "Input Validation",
      status: "Mandatory",
      statement:
        "Input crossing a trust boundary must be validated against an expected schema or allow-list before use, and queries must be parameterised rather than assembled by string concatenation.",
      rationale:
        "Injection remains the most frequently exploited class of application flaw, and it is prevented at the point data is accepted.",
      requirements: [
        "Each external input names the schema or allow-list it is checked against.",
        "Database access is parameterised.",
        "File uploads are checked for type and size before being stored.",
      ],
      owner: "Application Security",
    },
    {
      category: "Application Security",
      name: "Output Encoding",
      status: "Mandatory",
      statement:
        "Data rendered into a response must be encoded for the context it is rendered into, and user-supplied content must not be interpolated into markup or scripts unencoded.",
      rationale:
        "Content that is safe in a database becomes executable when it reaches a browser in the wrong context.",
      requirements: [
        "User-supplied content is encoded for its rendering context.",
        "A content security policy is stated for browser-delivered interfaces.",
        "Rich content accepted from users is sanitised against an allow-list.",
      ],
      owner: "Application Security",
    },
    {
      category: "Application Security",
      name: "Safe Error Handling",
      status: "Mandatory",
      statement:
        "Error responses must not disclose stack traces, internal host names, connection strings or query fragments to an external caller.",
      rationale:
        "Error output is the cheapest reconnaissance available to an attacker and is usually enabled by a configuration nobody revisited.",
      requirements: [
        "External error responses carry a reference rather than internal detail.",
        "Debug modes are disabled in production.",
        "The full detail is available internally against that reference.",
      ],
      owner: "Application Security",
    },
    {
      category: "Application Security",
      name: "Dependency Provenance",
      status: "Mandatory",
      statement:
        "Third-party libraries and base images must be drawn from an approved registry, pinned to a specific version, and recorded in a dependency inventory.",
      rationale:
        "An unpinned dependency pulled from an arbitrary source means the deployed system is not the system that was reviewed.",
      requirements: [
        "Dependencies are pinned to a specific version rather than a moving tag.",
        "Base images come from an approved registry.",
        "A dependency inventory is produced at build time.",
      ],
      owner: "Application Security",
    },
    {
      category: "Application Security",
      name: "Security Testing in the Pipeline",
      status: "Recommended",
      statement:
        "Delivery pipelines should run dependency, static and secret scanning on every change, and should fail the build on findings above an agreed severity.",
      rationale:
        "A scan whose findings never block anything records problems rather than preventing them.",
      requirements: [
        "Dependency, static and secret scanning run on every change.",
        "A severity threshold that fails the build is stated.",
        "Suppressions are recorded with a reason and an expiry.",
      ],
      owner: "Application Security",
    },

    // ---- Logging and Monitoring -------------------------------------------
    {
      category: "Logging and Monitoring",
      name: "Security Event Logging",
      status: "Mandatory",
      statement:
        "Authentication outcomes, authorisation failures, privilege changes and administrative actions must be logged with a timestamp, the acting identity and the affected resource.",
      rationale:
        "An incident that cannot be reconstructed cannot be scoped, and an incident that cannot be scoped is disclosed in full.",
      requirements: [
        "Authentication successes and failures are logged.",
        "Authorisation failures and privilege changes are logged.",
        "Each entry carries a timestamp, the acting identity and the affected resource.",
      ],
      owner: "Security Operations",
    },
    {
      category: "Logging and Monitoring",
      name: "No Sensitive Data in Logs",
      status: "Mandatory",
      statement:
        "Logs, traces and error reports must not contain credentials, authentication tokens, full payment card numbers or unmasked personal data.",
      rationale:
        "Logs are replicated widely and read by people who were never granted access to the records those logs quote.",
      requirements: [
        "Sensitive fields are redacted before a log line is emitted.",
        "Request and response bodies are not logged wholesale at default levels.",
        "Third-party error reporting receives the same redaction.",
      ],
      owner: "Security Operations",
    },
    {
      category: "Logging and Monitoring",
      name: "Central Log Retention",
      status: "Mandatory",
      statement:
        "Security-relevant logs must be shipped to a central store outside the control of the system that produced them and retained for the period the organisation's policy requires.",
      rationale:
        "Logs held only on the compromised host are the first thing an intruder edits.",
      requirements: [
        "Logs are shipped off the producing host.",
        "The workload cannot delete or rewrite logs it has already emitted.",
        "A retention period is stated.",
      ],
      owner: "Security Operations",
    },
    {
      category: "Logging and Monitoring",
      name: "Alerting on Security Events",
      status: "Recommended",
      statement:
        "Designs should state which security events raise an alert, who receives it, and what response is expected.",
      rationale:
        "Detection that reaches nobody is recording, not monitoring.",
      requirements: [
        "The events that raise an alert are listed.",
        "A recipient is named for each alert.",
        "The expected response is stated.",
      ],
      owner: "Security Operations",
    },

    // ---- Vulnerability Management -----------------------------------------
    {
      category: "Vulnerability Management",
      name: "Patching and Supported Versions",
      status: "Mandatory",
      statement:
        "Components must run versions still receiving security support from their supplier, and the design must state how security patches reach production.",
      rationale:
        "An unsupported component accrues known, published, weaponised flaws that will never be fixed.",
      requirements: [
        "No component is past its supplier's security support date.",
        "The route by which a patch reaches production is stated.",
        "A target timescale for critical patches is stated.",
      ],
      owner: "Infrastructure Security",
    },
    {
      category: "Vulnerability Management",
      name: "Pre-Release Security Assessment",
      status: "Mandatory",
      statement:
        "Internet-facing systems and systems handling Restricted data must undergo a security assessment before first release and after any change to their trust boundary.",
      rationale:
        "A trust boundary is the one part of a design whose flaws are reachable by everybody.",
      requirements: [
        "An assessment is scheduled before first release.",
        "The trust boundaries of the system are identified.",
        "A change to a trust boundary triggers a further assessment.",
      ],
      owner: "Security Architecture",
    },
    {
      category: "Vulnerability Management",
      name: "Third-Party Assurance",
      status: "Mandatory",
      statement:
        "A design relying on a third-party service to process Confidential or Restricted data must record that supplier's security assurance position and the data it will hold.",
      rationale:
        "Outsourcing the processing does not outsource the accountability, and the assurance gap is usually discovered during an incident.",
      requirements: [
        "Each third party is named with the data it processes.",
        "The supplier's assurance position is recorded.",
        "The design states what happens to the data if the supplier is exited.",
      ],
      owner: "Security Architecture",
    },
    {
      category: "Vulnerability Management",
      name: "Denial of Service Resilience",
      status: "Recommended",
      statement:
        "Internet-facing services should state their rate-limiting and abuse-protection controls, including what happens to legitimate traffic once a limit is reached.",
      rationale:
        "An availability control that fails closed for everyone converts an attack into the outage it was meant to prevent.",
      requirements: [
        "Rate limits are stated per caller rather than only in aggregate.",
        "The response to an exceeded limit is stated.",
        "Expensive operations are protected separately from cheap ones.",
      ],
      owner: "Network Security",
    },
  ],
};
