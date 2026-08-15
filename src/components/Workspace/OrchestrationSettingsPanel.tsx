import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Save, SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import type { ProjectSettings, OrchestrationSettings } from '../../types';

interface Props {
    projectId: string;
}

/** Defaults mirror the Rust `OrchestrationSettings::default()`. */
const DEFAULTS: OrchestrationSettings = {
    planner: 'lean',
    validation: 'manual',
    max_review_passes: 1,
    max_reviewers: 1,
    max_autofix_cycles: 2,
    risk_threshold: 'medium',
    max_tokens_per_run: 200_000,
};

const Segmented = <T extends string>({ value, options, onChange }: {
    value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) => (
    <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {options.map((o) => (
            <button
                key={o.value}
                onClick={() => onChange(o.value)}
                className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    value === o.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-foreground/6'
                }`}
            >
                {o.label}
            </button>
        ))}
    </div>
);

const NumberField = ({ value, onChange, min, max, step = 1 }: {
    value: number; onChange: (v: number) => void; min: number; max: number; step?: number;
}) => (
    <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="w-32 bg-muted/30 rounded-lg px-3 py-1.5 text-[13px] outline-none border border-border focus:border-foreground/20"
    />
);

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border/40">
        <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground">{label}</div>
            {hint && <div className="text-[11px] text-muted-foreground/70 mt-0.5">{hint}</div>}
        </div>
        <div className="shrink-0">{children}</div>
    </div>
);

export const OrchestrationSettingsPanel: React.FC<Props> = ({ projectId }) => {
    const project = useAppStore((s) => s.projects.find((p) => p.id === projectId));
    const updateProjectSettings = useAppStore((s) => s.updateProjectSettings);

    const initial = useMemo<OrchestrationSettings>(() => {
        try {
            const parsed: ProjectSettings = project?.settings ? JSON.parse(project.settings) : {} as ProjectSettings;
            return { ...DEFAULTS, ...(parsed.orchestration ?? {}) };
        } catch {
            return DEFAULTS;
        }
    }, [project?.settings]);

    const [form, setForm] = useState<OrchestrationSettings>(initial);
    const [saving, setSaving] = useState(false);
    const set = <K extends keyof OrchestrationSettings>(k: K, v: OrchestrationSettings[K]) =>
        setForm((f) => ({ ...f, [k]: v }));

    const save = async () => {
        setSaving(true);
        try {
            let existing: Partial<ProjectSettings> = {};
            if (project?.settings) {
                try { existing = JSON.parse(project.settings); } catch { /* ignore */ }
            }
            await updateProjectSettings(projectId, JSON.stringify({ ...existing, orchestration: form }));
            toast.success('Limits saved');
        } catch (e) {
            toast.error(`Failed to save: ${e}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="h-full overflow-y-auto hide-scrollbar">
            <div className="max-w-2xl mx-auto p-6 space-y-4">
                <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
                    <h2 className="text-[15px] font-semibold text-foreground">Limits &amp; Budget</h2>
                </div>
                <p className="text-[12px] text-muted-foreground">
                    You set the ceiling. Defaults are conservative — the agent physically can&apos;t exceed
                    your token budget in a single run.
                </p>

                <div>
                    <Row label="Planner" hint="Lean is fast &amp; cheap; GSD is thorough and codebase-grounded.">
                        <Segmented value={form.planner} onChange={(v) => set('planner', v)}
                            options={[{ value: 'lean', label: 'Lean' }, { value: 'gsd', label: 'GSD' }]} />
                    </Row>

                    <Row label="Validation" hint="When the Review &amp; Ship pass runs.">
                        <Segmented value={form.validation} onChange={(v) => set('validation', v)}
                            options={[{ value: 'off', label: 'Off' }, { value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Auto' }]} />
                    </Row>

                    <Row label="Risk threshold" hint="Run the LLM review only at/above this risk.">
                        <Segmented value={form.risk_threshold} onChange={(v) => set('risk_threshold', v)}
                            options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
                    </Row>

                    <Row label="Review passes" hint="Adversarial review passes per validation.">
                        <NumberField value={form.max_review_passes} min={1} max={3} onChange={(v) => set('max_review_passes', v)} />
                    </Row>

                    <Row label="Reviewers" hint="Independent reviewers (voters) for higher confidence.">
                        <NumberField value={form.max_reviewers} min={1} max={5} onChange={(v) => set('max_reviewers', v)} />
                    </Row>

                    <Row label="Auto-fix cycles" hint="Fix → recheck cycles allowed per issue.">
                        <NumberField value={form.max_autofix_cycles} min={0} max={5} onChange={(v) => set('max_autofix_cycles', v)} />
                    </Row>

                    <Row label="Token budget / run" hint="Hard ceiling. Reaching it stops and escalates.">
                        <NumberField value={form.max_tokens_per_run} min={10000} max={5_000_000} step={10000} onChange={(v) => set('max_tokens_per_run', v)} />
                    </Row>
                </div>

                <button
                    onClick={save}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
                >
                    <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save limits'}
                </button>
            </div>
        </div>
    );
};
