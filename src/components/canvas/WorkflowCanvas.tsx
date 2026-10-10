"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIVE_RUN_PREFIX, type LiveEvent, type LiveStatus } from "@/lib/live-types";
import { DEMO_SCENARIOS, approveMockReply, simulateRun } from "@/lib/mock-run";
import { NODE_IDS, type NodeId, type RunState } from "@/lib/types";
import { DbNode, type DbNodeType } from "./DbNode";
import { DetailPanel } from "./DetailPanel";
import { MERGE, SPLIT, buildEdges } from "./edges";
import { JunctionNode, type JunctionNodeType } from "./JunctionNode";
import { RoadmapNode, type RoadmapNodeType } from "./RoadmapNode";
import { RunContext, type RoadmapId, type Selection } from "./run-context";
import { TopBar } from "./TopBar";
import { WorkflowNode, type WorkflowNodeType } from "./WorkflowNode";

const nodeTypes: NodeTypes = {
  workflow: WorkflowNode,
  db: DbNode,
  roadmap: RoadmapNode,
  junction: JunctionNode,
};

type CanvasNode = WorkflowNodeType | DbNodeType | RoadmapNodeType | JunctionNodeType;

// Nodes are placed by their centre; y = 0 is the line through the merge point,
// the order form, the inventory check and the reply.
const at = (size: number, x: number, y: number) => ({ x: x - size / 2, y: y - size / 2 });

const live = (id: NodeId, x: number, y: number): WorkflowNodeType => ({
  id,
  type: "workflow",
  position: at(96, x, y),
  data: {},
});

const soon = (id: RoadmapId, x: number, y: number): RoadmapNodeType => ({
  id,
  type: "roadmap",
  position: at(64, x, y),
  data: {},
});

const junction = (id: string, x: number): JunctionNodeType => ({
  id,
  type: "junction",
  position: at(10, x, 0),
  data: {},
  draggable: false,
  selectable: false,
  focusable: false,
});

const INITIAL_NODES: CanvasNode[] = [
  // Inputs: only Gmail is live; the others show the roadmap.
  soon("slack", 48, -250),
  live("gmail", 48, -80),
  soon("teams", 48, 100),
  soon("upload", 48, 260),
  // Every input merges into one line, which branches out to the readers again.
  junction(MERGE, 210),
  junction(SPLIT, 290),
  soon("excel", 440, -290),
  live("text", 440, -110),
  live("pdf", 440, 110),
  soon("image", 440, 300),
  live("template", 680, 0),
  live("inventory", 940, 0),
  live("reply", 1200, 0),
  // 64px circle centred under the inventory square.
  { id: "db", type: "db", position: at(64, 940, 234), data: {} },
];

const FIT_OPTIONS = { padding: 0.25 };

/** Re-fit the graph whenever the canvas changes size (window resize, drawer open/close). */
function FitOnResize() {
  const { fitView } = useReactFlow();
  const ready = useNodesInitialized();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);

  useEffect(() => {
    if (ready && width > 0 && height > 0) void fitView({ ...FIT_OPTIONS, duration: 200 });
  }, [ready, width, height, fitView]);

  return null;
}

export function WorkflowCanvas() {
  const [nodes, , onNodesChange] = useNodesState(INITIAL_NODES);
  const [run, setRun] = useState<RunState | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [scenarioId, setScenarioId] = useState(DEMO_SCENARIOS[0].id);
  const cancelRef = useRef<(() => void) | null>(null);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // The real pipeline: the server watches Gmail and streams every run update here.
  // A real RFQ takes over the canvas (and stops a simulation that was playing).
  useEffect(() => {
    const source = new EventSource("/api/live");
    let lastRunId: string | null = null;
    source.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as LiveEvent;
      if (e.type === "status") return setLive(e.status);
      if (e.run.id !== lastRunId) {
        lastRunId = e.run.id;
        cancelRef.current?.();
        cancelRef.current = null;
        setSendError(null);
      }
      setRun(e.run);
    };
    return () => source.close();
  }, []);

  const edges = useMemo(() => buildEdges(run), [run]);
  // Real Gmail runs are approved through the server; simulated ones only locally.
  const isLiveRun = run?.id.startsWith(LIVE_RUN_PREFIX) ?? false;
  const busy = run !== null && NODE_IDS.some((id) => run.nodes[id].status === "running");

  const simulate = useCallback(() => {
    cancelRef.current?.();
    setSendError(null);
    cancelRef.current = simulateRun(scenarioId, setRun);
  }, [scenarioId]);

  // Picking another scenario resets the canvas to idle until Simulate is clicked.
  const changeScenario = useCallback((id: string) => {
    cancelRef.current?.();
    cancelRef.current = null;
    setScenarioId(id);
    setRun(null);
  }, []);

  const approve = useCallback(async () => {
    if (!run) return;
    if (!isLiveRun) {
      setRun((r) => (r ? approveMockReply(r, new Date().toISOString()) : r));
      return;
    }
    setSendError(null);
    try {
      const res = await fetch("/api/live/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
      const data = (await res.json()) as { run?: RunState; error?: string };
      if (!res.ok || !data.run) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRun(data.run);
    } catch (err) {
      setSendError(`Not sent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [run, isLiveRun]);

  // Stop the timers if the canvas unmounts mid-run.
  useEffect(() => {
    const ref = cancelRef;
    return () => ref.current?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const context = useMemo(() => ({ run, selected }), [run, selected]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white">
      <TopBar
        scenarios={DEMO_SCENARIOS}
        scenarioId={scenarioId}
        onScenarioChange={changeScenario}
        onSimulate={simulate}
        busy={busy}
        live={live}
      />
      <main className="relative flex min-h-0 flex-1">
        <RunContext.Provider value={context}>
          <div className="relative min-w-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_, node) => {
                if (node.type !== "junction") setSelected(node.id as Selection);
              }}
              onPaneClick={() => setSelected(null)}
              fitView
              fitViewOptions={FIT_OPTIONS}
              minZoom={0.4}
              maxZoom={1.75}
              nodesConnectable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1.5}
                color="#d1d5db"
                bgColor="#ffffff"
              />
              <Controls position="bottom-left" showInteractive={false} />
              <FitOnResize />
            </ReactFlow>
          </div>
          {selected && (
            <DetailPanel
              selected={selected}
              run={run}
              onClose={() => setSelected(null)}
              onApprove={approve}
              live={isLiveRun}
              sendError={sendError}
            />
          )}
        </RunContext.Provider>
      </main>
    </div>
  );
}
