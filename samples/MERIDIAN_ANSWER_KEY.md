# Meridian One — answer key

The expected verdict for every clause of the six client registers against
`Meridian One Unified Solution Architecture` (MO-SAD-001 v1.0), as assessed in
request **AR-0006**.

```
standards/   ← upload as "Reference standard"
  Enterprise_Architecture_Standards.pdf     15 clauses   EA-001  … EA-015
  Solution_Architecture_Standards.pdf       33 clauses   SOL-001 … SOL-033
  Security_Standards.pdf                    36 clauses   SEC-001 … SEC-036
  Integration_Standards.pdf                 40 clauses   INT-001 … INT-040
  Infrastructure_Standards.pdf              18 clauses   INF-001 … INF-018
  Data_Standards.pdf                        28 clauses   DAT-001 … DAT-028
designs/     ← upload as "Design to assess"
  Meridian_One_Unified_Solution_Architecture.pdf    11pp
                                           170 clauses total
```

**How this differs from `ANSWER_KEY.md`.** That corpus was generated, with the
standards and designs written against each other so most clauses have a knowable
answer. This one is the opposite case and the more honest test: a real design
document, real client registers, and a key derived by reading the two against
each other by hand. Expect more legitimate disagreement on the `partial` rows.

**Two caveats, stated so nobody mistakes this for ground truth.**

1. The registers' **Status column is blank on every row** — all six workbooks,
   and every category rollup reads zero. Nothing says which clauses are
   Mandatory and which Recommended. Obligation here is read from each clause's
   own wording, which is what the engine does too. If the client populates that
   column, re-derive the `must`/`should` split before trusting any severity.
2. `INF-006` (GPU) and `SEC-035` (Generative AI) are `not_applicable` on a
   condition the clauses themselves state — this design has no GPU workloads and
   no generative AI. They are not silence.

---

## Meridian One as one project — expected verdicts

### Must get these right

Twenty-four rows. Nineteen are breaches the engine must find; five are clauses
this design genuinely meets, included so the suite catches a judge that has been
made too strict as readily as one that is too lenient.

| Clause | Expected | Why |
|---|---|---|
| SOL-002 | **contradicts** | §5 legacy and Order Read API share an Aurora schema; MO-ADR-007 keeps a direct REST call between them |
| SOL-012 | **contradicts** | §5 "a small set of admin screens calls the Legacy Order Hub directly through an internal URL" |
| SOL-017 | **covered** | §3 states p95 targets, 1,500 req/s, 2,500 events/sec and an 8x burst at design time |
| SOL-032 | **covered** | context, components, integration points, data flows, NFRs, risks and ADRs are all present |
| SEC-005 | **contradicts** | §8 "two vendor support accounts are shared … disabled manually after contract end" |
| SEC-006 | **contradicts** | §8 "Legacy operations console has username/password authentication" against a clause requiring MFA for privileged access |
| SEC-008 | **contradicts** | §8 emergency EC2 access by a shared SSH key, "session recording is not enabled for this path" |
| SEC-014 | **contradicts** | §8 one internal endpoint "trusts requests from the VPC and does not validate a user or service token" |
| SEC-019 | **contradicts** | §8 "two legacy integrations read credentials from local environment files" |
| INT-002 | **covered** | §6 states latency, frequency and volume for every interface |
| INT-014 | **contradicts** | the EIP is absent; Mirth Connect and point-to-point calls carry the integration estate |
| INT-032 | **contradicts** | shared schema plus §4 "selected reports query Aurora replicas" directly |
| INT-037 | **contradicts** | §7 "Refund endpoint has no enforced idempotency key for legacy orders" |
| INF-011 | **covered** | §9 Aurora PostgreSQL in production, RDS in staging — the stack's stated default |
| INF-013 | **contradicts** | §9 "one legacy build downloads a public npm package directly during production deployment" |
| INF-018 | **contradicts** | §9 "the legacy Node.js runtime is two major versions behind the current LTS" |
| EA-007 | **contradicts** | new Redshift marts on a Hold technology; Mirth Connect is not in the stack at all |
| EA-008 | **contradicts** | Mirth Connect is not in the Technology Stack and no approval is recorded |
| EA-010 | **covered** | AWS throughout, and §13 pre-empts the question: the analytics account is transitional, not multi-cloud |
| EA-015 | **absent** | no Databricks, SageMaker or Bedrock anywhere; the design never engages the AIDP |
| DAT-005 | **contradicts** | §7 campaign price overrides "may supersede service values"; order state written by two systems |
| DAT-015 | **contradicts** | §7 "No central reference-data service; weekly spreadsheet distribution" |
| DAT-019 | **contradicts** | §8 the clinic reporting bucket "grants read access to a broad operations group" over Restricted data |
| DAT-020 | **contradicts** | §8 a legacy SFTP export's "staging file remains unencrypted on an EC2 volume" |

### Directionally right

The remaining 146. A verdict one step from expected is not a failure here.

| Clause | Expected | Note |
|---|---|---|
| SOL-001 | partial | reuse is claimed but not demonstrated; Mirth displaces an existing enterprise capability |
| SOL-003 | partial | REST/OpenAPI used, but not every interface has a design record |
| SOL-004 | covered | AWS-native throughout, no unnecessary proprietary dependence |
| SOL-005 | partial | Redis holds session state, but the legacy host depends on local filesystem and EBS uploads |
| SOL-006 | partial | retries and DLQs in places; no shared circuit-breaker configuration |
| SOL-007 | partial | security designed in for new services; the threat model excludes the legacy order stack |
| SOL-008 | partial | pipelines for new work; manual DNS, IAM, Mirth config and DB migrations |
| SOL-009 | partial | new services are layered; the legacy application still holds shared business modules |
| SOL-010 | partial | decomposition is real but mid-migration, with no committed milestones |
| SOL-011 | contradicts | legacy runs on a manually patched EC2 instance; one adapter ships as a vendor VM image |
| SOL-013 | covered | synchronous, asynchronous, batch and native are each used where the standard says |
| SOL-014 | covered | EventBridge is a shared event backbone with multiple consumers |
| SOL-015 | partial | API Gateway fronts public routes; internal traffic "sometimes bypasses the gateway" |
| SOL-016 | contradicts | no explicit consistency strategy; dual writers and a refund path without idempotency |
| SOL-018 | partial | availability targets set by criticality; restore evidence incomplete, two AZs only |
| SOL-019 | partial | OTel and Datadog for new services; legacy and Mirth logs stay on their hosts |
| SOL-020 | partial | debt tracked in Jira for new work, a spreadsheet for legacy |
| SOL-021 | contradicts | a single EC2 instance carries order amendments, refunds and inventory reservation |
| SOL-022 | contradicts | "All infrastructure must be provisioned from version-controlled declarative code" — DNS, IAM and Mirth are not |
| SOL-023 | covered | production containers run on EKS, the approved platform |
| SOL-024 | covered | layered structure is the default for the new services |
| SOL-025 | covered | microservices used for independently owned capabilities |
| SOL-026 | covered | publish/subscribe for cross-domain business events |
| SOL-027 | absent | neither CQRS nor Saga is engaged; the Order Read API shares a schema rather than separating concerns |
| SOL-028 | partial | MO-ADR-003 is explicitly a strangler, with no roadmap or milestones |
| SOL-029 | partial | bulkhead and sidecar absent, circuit breaker explicitly not configured |
| SOL-030 | covered | API Gateway plus separate mobile and web BFFs |
| SOL-031 | partial | most layers covered; messaging and eventing choices are not reconciled to the stack |
| SOL-033 | partial | ADRs exist; "not every record has a formal status or alternatives analysis" |
| SEC-001 | covered | a corporate security policy and risk register are in place |
| SEC-002 | partial | R-10 records that ownership is split and accountability unclear |
| SEC-003 | partial | mandatory for finance releases only; marketplace and clinic use a checklist |
| SEC-004 | partial | exceptions are neither time-bound nor approved; §13 says so outright |
| SEC-007 | partial | RBAC for new services; legacy roles live in its own database |
| SEC-009 | partial | private subnets by default, but a broad inbound rule from the corporate VPN CIDR |
| SEC-010 | contradicts | that broad rule against a default-deny clause with periodic review |
| SEC-011 | covered | remote access is approved, encrypted and MFA-protected |
| SEC-012 | contradicts | the legacy repository is excluded from the standard pipeline; the threat model does not cover it |
| SEC-013 | contradicts | SAST runs on two repositories only; the legacy repository is excluded |
| SEC-015 | contradicts | no approved hardening baseline for the legacy host or the vendor VM |
| SEC-016 | absent | endpoint protection is never addressed |
| SEC-017 | partial | change tickets for EKS; legacy SSH deploys and Mirth console edits sit outside |
| SEC-018 | contradicts | Restricted data at rest unencrypted in the SFTP staging file; no algorithms or TLS versions stated |
| SEC-020 | absent | data loss prevention is never addressed |
| SEC-021 | absent | no shared responsibility split is documented for any cloud service |
| SEC-022 | contradicts | the analytics account has "a separate baseline and incomplete guardrail coverage" |
| SEC-023 | partial | IAM roles in production; the analytics account diverges |
| SEC-024 | contradicts | Mirth and legacy logs "remain on their respective hosts; retention differs" |
| SEC-025 | covered | a documented incident process and severity matrix exist |
| SEC-026 | partial | a severity matrix exists; the clause's response times are not stated |
| SEC-027 | partial | dependency scanning for new services; no scan coverage or SLA for legacy |
| SEC-028 | contradicts | a runtime two major versions behind LTS, retained deliberately |
| SEC-029 | partial | payment and bureau assessed; one clinic partner on a legacy contract |
| SEC-030 | contradicts | one clinic partner has no explicit security incident notification SLA |
| SEC-031 | partial | RTO and RPO defined; tests annual for finance, marketplace evidence incomplete |
| SEC-032 | partial | AWS Backup in place; vault lock not enabled on all plans, restore tests inconsistent |
| SEC-033 | absent | a security awareness programme is never addressed |
| SEC-034 | absent | role-based security training is never addressed |
| SEC-035 | not_applicable | the clause governs production generative AI; this design has none |
| SEC-036 | absent | a data lake exists; no PII scanning or fine-grained access is described for it |
| INT-001 | covered | §6 starts from interaction behaviour, not available technology |
| INT-003 | covered | every interface is classified into one of the five patterns |
| INT-004 | covered | a mechanism is named for each — REST, webhook, SFTP, HL7, CDC |
| INT-005 | contradicts | "Not all interfaces have a complete integration design record" |
| INT-006 | absent | message ordering requirements are never stated anywhere |
| INT-007 | covered | request-response used where the caller needs an immediate answer |
| INT-008 | covered | Credit→Bureau submits and takes the result later |
| INT-009 | covered | order events published once to independent consumers |
| INT-010 | covered | nightly warehouse CSV and daily settlement are correctly batch |
| INT-011 | covered | Cognito, SSO and vendor connectors used for standard product features |
| INT-012 | covered | callback preferred for bureau results, polling only as fallback |
| INT-013 | contradicts | multi-system flows run on Step Functions and Mirth, not the EIP |
| INT-015 | contradicts | MO-ADR-007 gives a rationale but no justification against the exception criteria |
| INT-016 | covered | native AWS integration is used where both ends sit in AWS |
| INT-017 | covered | analytical movement runs on data pipelines, not the integration layer |
| INT-018 | contradicts | "no full end-to-end peak test", with stated volumes above the guideline thresholds |
| INT-019 | contradicts | 1,500 req/s platform-wide against an indicative ceiling of ~100 req/s |
| INT-020 | covered | submission volumes sit inside the request-acknowledge guideline |
| INT-021 | covered | the payment webhook is inside the callback guideline |
| INT-022 | partial | polling is a correct fallback for the bureau, but order fulfilment polls on a schedule unjustified |
| INT-023 | covered | no bulk endpoint exceeds the stated limits |
| INT-024 | contradicts | 2,500 events/sec over EventBridge and SQS, above the messaging guideline |
| INT-025 | absent | no event-streaming platform is used; MSK and Kafka appear nowhere |
| INT-026 | covered | 50–200 MB nightly files sit inside the file transfer guideline |
| INT-027 | partial | a vendor-delivered VM adapter with no stated governance |
| INT-028 | covered | SSO, identity federation and SMTP use built-in product setup |
| INT-029 | covered | CDC into Redshift is within the data pipeline guideline |
| INT-030 | covered | patterns are chosen against business need throughout §6 |
| INT-031 | partial | integration logic sits inside Checkout and the legacy application, not as discoverable assets |
| INT-033 | contradicts | an endpoint crossing a trust boundary that validates no token at all |
| INT-034 | partial | partner constraints respected; the legacy host's limits drive design without being stated |
| INT-035 | contradicts | spreadsheets supersede the Catalog service; finance keeps its own refund preferences |
| INT-036 | partial | new services are traced; "legacy and partner integration traces are not end-to-end correlated" |
| INT-038 | contradicts | "event schemas not all centrally registered"; contracts not agreed before implementation |
| INT-039 | partial | Enterprise Architecture is named as a stakeholder; no architecture review is evidenced |
| INT-040 | contradicts | R-07 — no integration inventory, schema registry or contract lifecycle ownership |
| INF-001 | contradicts | the analytics account sits outside the landing zone with incomplete guardrails |
| INF-002 | contradicts | DNS records, selected IAM policies and Mirth host configuration are maintained manually |
| INF-003 | contradicts | a manually patched EC2 host and a vendor VM image, neither from a hardened base |
| INF-004 | partial | the order is followed with a documented legacy exception; the utility host has none |
| INF-005 | partial | Karpenter on the primary cluster only; a second cluster scales manually; GitOps excludes Mirth |
| INF-006 | not_applicable | the clause governs GPU and accelerated compute; this design has none |
| INF-007 | partial | VPCs and Transit Gateway as required; "some AWS service access uses public endpoints rather than PrivateLink" |
| INF-008 | covered | CloudFront and WAF in front of internet-facing endpoints |
| INF-009 | partial | Route 53 is used; failover routing is not stated and DNS is managed by hand |
| INF-010 | covered | S3 for objects, EBS for block, as the standard sets out |
| INF-012 | partial | GitHub Actions with OIDC for new services; the legacy deploy is an SSH copy outside it |
| INF-014 | partial | OpenTelemetry, Datadog and CloudWatch in place; legacy host alerts go to email, not PagerDuty |
| INF-015 | contradicts | "vault lock is not enabled on all backup plans"; restore tests inconsistent |
| INF-016 | partial | EKS across two AZs and Aurora Multi-AZ; the legacy host is a single instance |
| INF-017 | contradicts | shared network and analytics costs are not allocated; budget alerts cover production only |
| EA-001 | partial | a draft for technical review with named technical approvers, but no ARB approval |
| EA-002 | partial | ADRs are kept with the solution; status and alternatives are incomplete |
| EA-003 | partial | reference architecture acknowledged; deviations carry no written justification |
| EA-004 | contradicts | multiple live deviations with no requested, risk-assessed or time-bound exception |
| EA-005 | partial | a risk register with treatments, but no remediation dates or owners |
| EA-006 | partial | document control names an owner, sponsor and approvers; NFR accountability is unstated |
| EA-009 | contradicts | Hold items retained with no migration plan; "temporary decisions have no committed retirement date" |
| EA-011 | partial | managed services used throughout; no lock-in risk recorded in any ADR |
| EA-012 | contradicts | Mirth Connect built in where an approved enterprise integration platform already exists |
| EA-013 | partial | most layers covered; messaging, eventing and governance choices are not reconciled to the model |
| EA-014 | contradicts | R-10 — "technology and platform ownership is split across teams", accountability unclear |
| DAT-001 | contradicts | "Clinic and Marketing datasets have operational contacts but no formally named Data Owner" |
| DAT-002 | partial | a Data Governance Council meets quarterly; policies and escalation are not described |
| DAT-003 | partial | quality is reported; standards compliance is not monitored or tracked to closure |
| DAT-004 | partial | raw, curated and serving layers intended; departmental exports load straight into reporting tables |
| DAT-006 | covered | OLTP, lakehouse, lake and cache are each chosen by access pattern |
| DAT-007 | partial | "Parquet for new feeds; some CSV and JSON files remain" |
| DAT-008 | absent | conceptual, logical and physical modelling is never addressed |
| DAT-009 | absent | no naming convention is stated anywhere |
| DAT-010 | absent | standard types and formats for common domains are never addressed |
| DAT-011 | partial | completeness and validity covered; uniqueness and timeliness manual; accuracy and consistency absent |
| DAT-012 | partial | automated checks on customer and loan data only |
| DAT-013 | partial | a duplicate-rate target exists; no tolerances agreed per critical domain |
| DAT-014 | contradicts | "Duplicate merge is a manual workflow" with no matching, merging or survivorship rules |
| DAT-016 | partial | business and technical metadata "for selected high-value datasets" |
| DAT-017 | partial | a catalog covers the lake but "does not include all operational databases" |
| DAT-018 | covered | Public/Internal/Confidential/Restricted applied, with Restricted named for financial and clinical data |
| DAT-021 | partial | privacy obligations deferred to legal; no uniform deletion workflow |
| DAT-022 | covered | batch, messaging, event-driven and API patterns each used by latency and volume |
| DAT-023 | contradicts | "Not all integration contracts and event schemas are centrally registered" |
| DAT-024 | contradicts | no idempotency on the refund path; "DLQ for selected queues" only |
| DAT-025 | partial | validation and traceability in places; "several CSV feeds rely on manual mapping updates" |
| DAT-026 | partial | retention stated per domain; S3 lifecycle covers selected raw data only |
| DAT-027 | partial | sharing is traceable for lake data; partner extracts and spreadsheets are not |
| DAT-028 | contradicts | "the central platform does not yet apply one uniform deletion workflow" |

---

## Scoring

The 24 "must get these right" rows are the measure. Two failure modes matter far
more than the rest, and both are present in this corpus:

- **a contradiction reported as covered** — a gap shipped to production. The
  baseline run did this on DAT-005, SEC-006 and SEC-019.
- **a confident absent on something the design does address** — someone sent to
  fix what already exists.

A verdict one step from expected on a `partial` row is not a failure. A
confident verdict in the *opposite* direction from the evidence is.

Five `covered` rows — SOL-017, SOL-032, INT-002, INF-011, EA-010 — sit in the
must list on purpose. A judge pushed too hard toward finding breaches will fail
those before it fails anything else, and a strictness regression is otherwise
invisible in an aggregate score that is going up.
