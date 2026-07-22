function Section({ title, note, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium text-text">{title}</h2>
      {note && <p className="mb-3 text-xs text-muted">{note}</p>}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
    </section>
  );
}

function Row({ label, value, note }) {
  return (
    <div className="border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-40 shrink-0 text-sm text-text">{label}</span>
        <span className="min-w-0 flex-1 text-sm text-text/90">{value}</span>
      </div>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

function FlowCard({ index, title, body }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent">{index}</span>
        <h3 className="text-sm font-medium text-text">{title}</h3>
      </div>
      <p className="text-sm text-muted">{body}</p>
    </div>
  );
}

export default function DevScreen() {
  return (
    <div className="p-5 md:p-8">
      <div className="mb-6">
        <h1 className="text-lg font-medium text-text">Dev Architecture</h1>
        <p className="mt-1 text-sm text-muted">The system split by implementation logic: windows, processing stages, object types, and write boundaries.</p>
      </div>

      <Section title="Memory windows" note="Three live access windows over the same underlying long-term system.">
        <Row
          label="Realtime session memory"
          value="High-confidence facts, preferences, routines, and other very likely data for immediate conversation use."
          note="Excludes theories, weak hypotheses, and questionable claims."
        />
        <Row
          label="Short-term memory"
          value="Recent events plus basic general information needed for current context continuity."
          note="Acts as the bridge between live session use and deeper long-term memory."
        />
        <Row
          label="Long-term memory"
          value="The full database: entities, data objects, evidence, history, and deep inspection targets."
          note="Used for specific retrieval, deep analysis, and rebuilding the higher windows."
        />
      </Section>

      <Section title="Memory processing pipeline" note="Your current separation of how raw signal becomes usable memory.">
        <div className="grid gap-3 px-4 py-4 lg:grid-cols-2">
          <FlowCard
            index="1"
            title="Evidence objects"
            body="Immutable raw source outputs on the timestamp spectrum. This is the ingestion base layer from listeners, APIs, sessions, browser events, bank events, and other automations."
          />
          <FlowCard
            index="2"
            title="Structured observation layer"
            body="Fast, cheap extraction. Produces easy claims, updates memory windows, and creates or updates the first structured objects without expensive reasoning."
          />
          <FlowCard
            index="3"
            title="Derived knowledge layer"
            body="Slow, deep analysis. Produces stronger preferences, routines, relationships, theories, and higher-order knowledge from many earlier observations."
          />
          <FlowCard
            index="4"
            title="Runtime assembly"
            body="Not a stored layer. MemoryGate simply reads the existing entities and data objects to assemble the right response window when Hermes needs it."
          />
        </div>
      </Section>

      <Section title="Object model" note="The current architecture vocabulary, using objects rather than points.">
        <Row
          label="Evidence object"
          value="Raw automated source event. Immutable, timestamped, source-linked, and used as the support base for everything else."
        />
        <Row
          label="Analysis object"
          value="Lineage object between evidence and structured memory. Stores how evidence was interpreted and what conclusion or update followed."
        />
        <Row
          label="Data object"
          value="Structured memory claim. Can represent facts, preferences, states, routines, theories, patterns, and other typed knowledge."
        />
        <Row
          label="Entity object"
          value="A structured object made from many data objects that share a real-world identity, like a person, place, project, or concept."
        />
      </Section>

      <Section title="Truth and history model" note="What changes over time, what gets removed, and what does not need a separate state machine.">
        <Row
          label="Normal change"
          value="Data that changes with time should be updated with timestamps, not marked as philosophically incorrect."
          note="Examples: age, routine, active state, current preference strength."
        />
        <Row
          label="False support collapse"
          value="If the only evidence supporting a claim becomes invalid, the active claim should disappear from active memory."
          note="Example: wrong bank price survives only in audit logic, not as an active fact."
        />
        <Row
          label="Trash"
          value="Reserved for technical junk or invalid ingestion outcomes, not for ordinary life changes."
          note="Bad source payloads, malformed imports, broken automations."
        />
      </Section>

      <Section title="Write boundaries" note="Who is allowed to mutate the system and who is only allowed to observe it.">
        <Row
          label="MemoryGate"
          value="Create, update, remove, analyze, invalidate, and manage lineage."
        />
        <Row
          label="Outside systems"
          value="Read-only through CLI or API, plus signal submission through controlled ingestion paths."
          note="No direct destructive writes from the conversational agent."
        />
      </Section>

      <Section title="Search priority" note="The current developer mental model for deep inspection and retrieval ordering.">
        <Row
          label="1. Entity objects"
          value="Top priority for structured world-model lookup."
        />
        <Row
          label="2. Data objects"
          value="Typed claims, preferences, facts, routines, theories, and other structured memory units."
        />
        <Row
          label="3. Evidence objects"
          value="Deepest source-level backing for verification, audit, and research."
        />
      </Section>
    </div>
  );
}
