"use client";

import {
  Bot,
  Gavel,
  ListTree,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  User,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SPEEDS, type Mode } from "./useInvestigation";

export interface ControlBarProps {
  active: boolean;
  started: boolean;
  busy: boolean;
  hasRecommendation: boolean;
  recommendedIsTest: boolean;
  mode: Mode;
  onMode: (m: Mode) => void;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
  onExecuteRecommended: () => void;
  onChooseTest: () => void;
  onDeclare: () => void;
  onReset: () => void;
  onTrace: () => void;
}

/** All investigation controls in one keyboard-reachable bar. */
export function ControlBar(p: ControlBarProps) {
  const disabled = !p.active || p.busy;
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <Segmented<Mode>
          label="Investigation mode"
          value={p.mode}
          onChange={p.onMode}
          options={[
            { value: "manual", label: <span className="inline-flex items-center gap-1.5"><User className="size-3.5" aria-hidden />Manual</span>, title: "You choose each test" },
            { value: "agent", label: <span className="inline-flex items-center gap-1.5"><Bot className="size-3.5" aria-hidden />Agent</span>, title: "The selected policy chooses the actions" },
          ]}
        />

        {p.mode === "agent" ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Agent playback">
            {p.playing ? (
              <Button variant="secondary" size="sm" onClick={() => p.onPlayingChange(false)} disabled={!p.active}>
                <Pause /> Pause
              </Button>
            ) : (
              <Button size="sm" onClick={() => p.onPlayingChange(true)} disabled={!p.active || !p.hasRecommendation}>
                <Play /> {p.started ? "Resume" : "Run agent"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={p.onExecuteRecommended}
              disabled={disabled || p.playing || !p.hasRecommendation}
            >
              <SkipForward /> Step forward
            </Button>
            <Tip content="Changes how quickly the agent advances on screen. Modelled test durations, costs and rewards are not affected.">
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <Zap className="size-3.5" aria-hidden />
                <span className="sr-only">Visualization speed</span>
                <select
                  aria-label="Visualization speed"
                  value={p.speed}
                  onChange={(e) => p.onSpeed(Number(e.target.value))}
                  className="h-8 rounded-lg border border-border bg-elevated px-2 text-xs text-ink"
                >
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}× speed
                    </option>
                  ))}
                </select>
              </label>
            </Tip>
          </div>
        ) : (
          <Button size="sm" onClick={p.onExecuteRecommended} disabled={disabled || !p.hasRecommendation}>
            <ListChecks /> {p.recommendedIsTest ? "Execute recommended test" : "Declare as recommended"}
          </Button>
        )}

        <div className={cn("flex flex-wrap items-center gap-2 lg:ml-auto")}>
          <Button variant="outline" size="sm" onClick={p.onChooseTest} disabled={disabled}>
            <ListTree /> Choose another test
          </Button>
          <Button variant="outline" size="sm" onClick={p.onDeclare} disabled={disabled}>
            <Gavel /> Declare root cause
          </Button>
          <Button variant="ghost" size="sm" onClick={p.onTrace}>
            View trace
          </Button>
          <Button variant="ghost" size="sm" onClick={p.onReset} disabled={p.busy}>
            <RotateCcw /> Reset
          </Button>
        </div>
      </div>
    </Card>
  );
}
