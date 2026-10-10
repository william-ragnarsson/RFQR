"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LIVE_RUN_PREFIX, type LiveEvent, type LiveStatus } from "@/lib/live-types";
import { DEMO_SCENARIOS, approveMockReply, simulateRun } from "@/lib/mock-run";
import { NODE_IDS, type NodeId, type NodeStatus, type RunState } from "@/lib/types";
import { DbNode, type DbNodeType } from "./DbNode";
import { DetailPanel } from "./DetailPanel";
import { RunContext, nodeState, type Selection } from "./run-context";
import { TopBar } from "./TopBar";
import { WorkflowNode, type WorkflowNodeType } from "./WorkflowNode";

const nodeTypes: NodeTypes = { workflow: WorkflowNode, db: DbNode };

const POSITIONS: Record<NodeId, { x: number; y: number }> = {
  gmail: { x: 0, y: 150 },
  text: { x: 260, y: 30 },
  pdf: { x: 260, y: 270 },
  template: { x: 540, y: 150 },
  inventory: { x: 800, y: 150 },
  reply: { x: 1060, y: 150 },
};

const INITIAL_NODES: (WorkflowNodeType | DbNodeType)[] = [
  ...NODE_IDS.map(
    (id): WorkflowNodeType => ({ id, type: "workflow", position: POSITIONS[id], data: {} }),
  ),
  // 64px circle centred under the 96px inventory square.
  { id: "db", type: "db", position: { x: 816, y: 400 }, data: {} },
];

const FLOW: [NodeId, NodeId][] = [
  ["gmail", "text"],
  ["gmail", "pdf"],
  ["text", "template"],
  ["pdf", "template"],
  ["template", "inventory"],
  ["inventory", "reply"],
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

const INDIGO = "#6366f1";
const DARK = "#6b7280";
const LIGHT = "#d1d5db";
const FINISHED: NodeStatus[] = ["done", "warning", "awaiting", "error"];

function buildEdges(run: RunState | null): Edge[] {
  const edges: Edge[] = FLOW.map(([source, target]) => {
    const from = nodeState(run, source).status;
    const to = nodeState(run, target).status;
    const running = to === "running";
    const skipped = from === "skipped" || to === "skipped";
    const color = running ? INDIGO : !skipped && FINISHED.includes(to) ? DARK : LIGHT;
    return {
      id: `${source}-${target}`,
      source,
      target,
      animated: running,
      style: {
        stroke: color,
        strokeWidth: 1.5,
        ...(skipped ? { strokeDasharray: "4 4" } : {}),
      },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
    };
  });

  const inventoryRunning = nodeState(run, "inventory").status === "running";
  edges.push({
    id: "db-inventory",
    source: "db",
    sourceHandle: "db",
    target: "inventory",
    targetHandle: "db",
    type: "straight",
    animated: inventoryRunning,
    style: { stroke: inventoryRunning ? INDIGO : "#9ca3af", strokeWidth: 1.5, strokeDasharray: "5 5" },
  });

  return edges;
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
              onNodeClick={(_, node) => setSelected(node.id as Selection)}
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
