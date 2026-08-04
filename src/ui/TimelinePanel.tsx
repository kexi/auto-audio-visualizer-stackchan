import { useEffect, useMemo, useRef, useState } from 'react';
import type { SynthControlState } from '../synth/control';
import { getSynthControl } from '../synth/control';
import { serializePatch } from '../synth/schema';
import type {
  PerformanceTimeline,
  SemanticIntent,
  TimeAnchor,
  VisualEvent,
} from '../synth/timeline';
import type { TransitionSpec, VisualPatch } from '../synth/types';
import { DEFAULT_TRANSITION } from '../synth/types';
import { randomSeed } from '../variation/generate';

interface TimelinePanelProps {
  hidden: boolean;
}

/** Anchor unit selectable in the add-event form. */
type AddUnit = 'sec' | 'bars' | 'external';

type PresetId = 'default' | 'slow' | 'cut';

const TRANSITION_PRESETS: Record<PresetId, TransitionSpec> = {
  default: DEFAULT_TRANSITION,
  slow: {
    paletteMs: DEFAULT_TRANSITION.paletteMs * 2,
    parameterMs: DEFAULT_TRANSITION.parameterMs * 2,
    modulationMs: DEFAULT_TRANSITION.modulationMs * 2,
    topologyMs: DEFAULT_TRANSITION.topologyMs * 2,
    easing: DEFAULT_TRANSITION.easing,
  },
  cut: {
    paletteMs: 120,
    parameterMs: 120,
    modulationMs: 120,
    topologyMs: 120,
    easing: DEFAULT_TRANSITION.easing,
  },
};

/** Pretty-print the patch through the canonical (key-sorted) serialization. */
function formatPatch(patch: VisualPatch | null): string {
  if (!patch) return '';
  try {
    return JSON.stringify(JSON.parse(serializePatch(patch)) as unknown, null, 2);
  } catch {
    return '';
  }
}

/** Display order group: seconds first, then bar, then external. */
function anchorGroup(a: TimeAnchor): number {
  switch (a.kind) {
    case 'seconds':
      return 0;
    case 'bar':
      return 1;
    case 'external':
      return 2;
  }
}

function anchorKey(a: TimeAnchor): number {
  switch (a.kind) {
    case 'seconds':
      return a.atSec;
    case 'bar':
      return a.bar;
    case 'external':
      return 0;
  }
}

function anchorLabel(a: TimeAnchor): string {
  switch (a.kind) {
    case 'seconds':
      return `@${a.atSec.toFixed(1)}s`;
    case 'bar':
      return `@bar ${a.bar}`;
    case 'external':
      return `@ext:${a.id}`;
  }
}

function intentLabel(intent: SemanticIntent): string {
  const parts: string[] = [];
  if (intent.label) parts.push(intent.label);
  if (intent.seed) parts.push(`seed: ${intent.seed}`);
  if (intent.patch) parts.push('patch');
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** Fire-order view of the timeline; never mutates the source array. */
function sortedEvents(tl: PerformanceTimeline): VisualEvent[] {
  return [...tl.events].sort((a, b) => {
    const g = anchorGroup(a.start) - anchorGroup(b.start);
    if (g !== 0) return g;
    const k = anchorKey(a.start) - anchorKey(b.start);
    if (k !== 0) return k;
    return a.id.localeCompare(b.id);
  });
}

function numberOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function TimelinePanel(props: TimelinePanelProps): React.ReactElement {
  const { hidden } = props;

  // Singleton bridge to the synth scene; memoized so the subscription below is
  // established exactly once.
  const control = useMemo(() => getSynthControl(), []);
  const [state, setState] = useState<SynthControlState>(() => control.getState());

  useEffect(() => {
    // Pick up anything registered between the initial read and the subscribe.
    setState(control.getState());
    return control.subscribe(() => setState(control.getState()));
  }, [control]);

  const [collapsed, setCollapsed] = useState(false);

  // ---- Patch editor ----
  const patchText = useMemo(() => formatPatch(state.currentPatch), [state.currentPatch]);
  const [patchDraft, setPatchDraft] = useState(patchText);
  const [patchDirty, setPatchDirty] = useState(false);
  const [patchIssues, setPatchIssues] = useState<string[]>([]);
  // Readable from the sync effect without re-running it on every dirty flip.
  const patchDirtyRef = useRef(patchDirty);
  patchDirtyRef.current = patchDirty;

  // Follow the live patch while the user has not touched the textarea.
  useEffect(() => {
    if (patchDirtyRef.current) return;
    setPatchDraft(patchText);
  }, [patchText]);

  const reloadPatch = (): void => {
    setPatchDraft(formatPatch(control.getState().currentPatch));
    setPatchDirty(false);
    setPatchIssues([]);
  };

  const applyPatch = (): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(patchDraft) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPatchIssues([`invalid JSON: ${message}`]);
      return;
    }
    const res = control.proposePatch(parsed);
    if (res.ok) {
      setPatchIssues([]);
      setPatchDirty(false);
    } else {
      setPatchIssues(res.issues.length > 0 ? res.issues : ['patch rejected']);
    }
  };

  // ---- Timeline ops ----
  const [opIssue, setOpIssue] = useState<string | null>(null);

  const removeEvent = (id: string): void => {
    const res = control.applyTimelineOp({ op: 'remove', id });
    setOpIssue(res.ok ? null : (res.issue ?? 'remove failed'));
  };

  // ---- Add-event form ----
  const [unit, setUnit] = useState<AddUnit>('sec');
  const [offset, setOffset] = useState(1);
  const [externalId, setExternalId] = useState('drop');
  const [seedDraft, setSeedDraft] = useState('');
  const [preset, setPreset] = useState<PresetId>('default');
  const [addIssue, setAddIssue] = useState<string | null>(null);
  const counterRef = useRef(0);

  const addEvent = (): void => {
    // Fresh clock: the subscribed snapshot may be several frames stale.
    const st = control.getState();
    const off = numberOr(offset, 0);
    let start: TimeAnchor;
    if (unit === 'sec') {
      start = { kind: 'seconds', atSec: st.nowSec + off };
    } else if (unit === 'bars') {
      start = { kind: 'bar', bar: Math.floor(st.barCount) + off };
    } else {
      const id = externalId.trim();
      if (!id) {
        setAddIssue('external id must not be empty');
        return;
      }
      start = { kind: 'external', id };
    }

    const seed = seedDraft.trim() || randomSeed();
    counterRef.current += 1;
    const event: VisualEvent = {
      id: `ui-${Math.round(st.nowSec * 1000).toString(36)}-${counterRef.current}`,
      start,
      duration: { kind: 'untilNext' },
      intent: { seed, label: `ui ${seed}` },
      transition: TRANSITION_PRESETS[preset],
      confidence: 1,
      locked: false,
    };
    const res = control.applyTimelineOp({ op: 'add', event });
    setAddIssue(res.ok ? null : (res.issue ?? 'add failed'));
  };

  // ---- lockedUntil ----
  const [lockedUntilDraft, setLockedUntilDraft] = useState(0);
  const setLockedUntil = (): void => {
    const res = control.applyTimelineOp({
      op: 'setLockedUntil',
      sec: numberOr(lockedUntilDraft, 0),
    });
    setOpIssue(res.ok ? null : (res.issue ?? 'setLockedUntil failed'));
  };

  // ---- External trigger ----
  const [fireId, setFireId] = useState('drop');

  // ---- Recording ----
  const [recordIssues, setRecordIssues] = useState<string[]>([]);

  const toggleRecording = (): void => {
    if (!control.getState().recordingActive) {
      setRecordIssues([]);
      control.startRecording();
      return;
    }
    const json = control.stopRecording();
    if (json === null) return;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `performance-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadRecording = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = control.loadRecording(text);
    setRecordIssues(res.ok ? [] : res.issues.length > 0 ? res.issues : ['load failed']);
    // Allow re-selecting the same file.
    input.value = '';
  };

  const events = useMemo(() => sortedEvents(state.timeline), [state.timeline]);
  const firedSet = useMemo(() => new Set(state.firedIds), [state.firedIds]);

  const className = `tl-panel${hidden ? ' hidden' : ''}${collapsed ? ' collapsed' : ''}`;

  return (
    <div className={className} data-testid="timeline-panel">
      <div className="panel-header tl-header">
        <span className="panel-title">Timeline</span>
        <button
          type="button"
          className="btn small"
          data-testid="tl-toggle"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? '▸ open' : '▾ close'}
        </button>
      </div>

      <div className="tl-body">
        {/* ---- State ---- */}
        <div className="tl-section">
          <div className="row-label">
            <span>State</span>
            <span className="row-value">{state.transitionActive ? 'transitioning' : 'idle'}</span>
          </div>
          <div className="tl-kv">
            <span className="tl-k">seed</span>
            <span className="tl-v" data-testid="tl-current-seed">
              {state.currentPatch?.seed ?? '—'}
            </span>
          </div>
          <div className="tl-kv">
            <span className="tl-k">operators</span>
            <span className="tl-v">
              {state.currentPatch
                ? state.currentPatch.operators.map((o) => o.generatorId).join(' › ')
                : '—'}
            </span>
          </div>
          <div className="tl-kv">
            <span className="tl-k">quality</span>
            <span className="tl-v">{state.qualityScale.toFixed(2)}</span>
          </div>
          <div className="tl-kv">
            <span className="tl-k">tempo</span>
            <span className="tl-v">
              {state.tempoLocked ? 'locked' : 'free'} · bar {Math.floor(state.barCount)}
            </span>
          </div>
          {!state.currentPatch && (
            <div className="tl-note">no active synth scene — switch to Semantic Synth</div>
          )}
        </div>

        {/* ---- Patch editor ---- */}
        <div className="tl-section">
          <div className="row-label">
            <span>Patch</span>
            {patchDirty && <span className="row-value">edited</span>}
          </div>
          <textarea
            className="tl-json"
            data-testid="tl-patch-json"
            spellCheck={false}
            value={patchDraft}
            onChange={(e) => {
              setPatchDraft(e.target.value);
              setPatchDirty(true);
            }}
          />
          <div className="tl-form-row">
            <button
              type="button"
              className="btn small"
              data-testid="tl-patch-apply"
              onClick={applyPatch}
            >
              Apply
            </button>
            <button
              type="button"
              className="btn small"
              data-testid="tl-patch-reload"
              onClick={reloadPatch}
            >
              Reload
            </button>
          </div>
          {patchIssues.length > 0 && (
            <ul className="tl-issues" data-testid="tl-patch-issues">
              {patchIssues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- Timeline view ---- */}
        <div className="tl-section">
          <div className="row-label">
            <span>Events</span>
            <span className="row-value">{events.length}</span>
          </div>
          {events.length === 0 ? (
            <div className="tl-note">no events</div>
          ) : (
            <div className="tl-rows">
              {events.map((ev) => (
                <div className="tl-row" data-testid="tl-event-row" key={ev.id}>
                  <span className="tl-anchor">{anchorLabel(ev.start)}</span>
                  <span className="tl-intent" title={ev.id}>
                    {intentLabel(ev.intent)}
                  </span>
                  {ev.locked && <span className="tl-badge locked">locked</span>}
                  {firedSet.has(ev.id) && <span className="tl-badge fired">fired</span>}
                  <button
                    type="button"
                    className="btn small tl-remove"
                    data-testid="tl-event-remove"
                    aria-label={`Remove ${ev.id}`}
                    onClick={() => removeEvent(ev.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {opIssue && <div className="tl-issues">{opIssue}</div>}
        </div>

        {/* ---- Add event ---- */}
        <div className="tl-section">
          <div className="row-label">
            <span>Add event</span>
          </div>
          <div className="tl-form-row">
            <select
              data-testid="tl-add-unit"
              aria-label="Anchor unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value as AddUnit)}
            >
              <option value="sec">+sec</option>
              <option value="bars">+bars</option>
              <option value="external">external</option>
            </select>
            {unit === 'external' ? (
              <input
                type="text"
                className="seed-input"
                data-testid="tl-add-external-id"
                aria-label="External id"
                placeholder="external id"
                spellCheck={false}
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
              />
            ) : (
              <input
                type="number"
                step={1}
                data-testid="tl-add-offset"
                aria-label="Offset"
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
              />
            )}
          </div>
          <div className="tl-form-row">
            <input
              type="text"
              className="seed-input"
              data-testid="tl-add-seed"
              aria-label="Event seed"
              placeholder="random"
              spellCheck={false}
              value={seedDraft}
              onChange={(e) => setSeedDraft(e.target.value)}
            />
            <select
              data-testid="tl-add-preset"
              aria-label="Transition preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value as PresetId)}
            >
              <option value="default">default</option>
              <option value="slow">slow</option>
              <option value="cut">cut</option>
            </select>
            <button type="button" className="btn small" data-testid="tl-add" onClick={addEvent}>
              Add
            </button>
          </div>
          {unit === 'bars' && (
            <div className="tl-note">bar anchors only fire while the tempo grid is locked</div>
          )}
          {addIssue && (
            <div className="tl-issues" data-testid="tl-add-issue">
              {addIssue}
            </div>
          )}
        </div>

        {/* ---- lockedUntil ---- */}
        <div className="tl-section">
          <div className="row-label">
            <span>Locked until</span>
            <span className="row-value">{state.timeline.lockedUntilSec.toFixed(2)}s</span>
          </div>
          <div className="tl-form-row">
            <input
              type="number"
              step={1}
              data-testid="tl-locked-until"
              aria-label="Locked until seconds"
              value={lockedUntilDraft}
              onChange={(e) => setLockedUntilDraft(Number(e.target.value))}
            />
            <button
              type="button"
              className="btn small"
              data-testid="tl-locked-set"
              onClick={setLockedUntil}
            >
              Set
            </button>
          </div>
        </div>

        {/* ---- External trigger ---- */}
        <div className="tl-section">
          <div className="row-label">
            <span>External</span>
          </div>
          <div className="tl-form-row">
            <input
              type="text"
              className="seed-input"
              data-testid="tl-fire-id"
              aria-label="External event id"
              placeholder="external id"
              spellCheck={false}
              value={fireId}
              onChange={(e) => setFireId(e.target.value)}
            />
            <button
              type="button"
              className="btn small"
              data-testid="tl-fire"
              onClick={() => control.fireExternal(fireId.trim())}
            >
              Fire
            </button>
          </div>
        </div>

        {/* ---- Recording ---- */}
        <div className="tl-section">
          <div className="row-label">
            <span>Recording</span>
            <span className="row-value">{state.recordingActive ? 'REC' : 'off'}</span>
          </div>
          <div className="tl-form-row">
            <button
              type="button"
              className={`btn small${state.recordingActive ? ' on' : ''}`}
              data-testid="tl-record"
              onClick={toggleRecording}
            >
              {state.recordingActive ? '■ Stop & save' : '● Record'}
            </button>
            <input
              type="file"
              className="tl-file"
              accept="application/json"
              data-testid="tl-load"
              aria-label="Load recording"
              onChange={(e) => {
                void loadRecording(e.target);
              }}
            />
          </div>
          {recordIssues.length > 0 && (
            <ul className="tl-issues" data-testid="tl-record-issues">
              {recordIssues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
