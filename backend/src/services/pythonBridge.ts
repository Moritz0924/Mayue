import { spawn } from "node:child_process";
import path from "node:path";
import { loadConfig } from "../app/config.js";
import { getRepoRoot } from "../demo/repository.js";

export type PythonTask = "predict_displacement" | "evaluate_vibration" | "align_spatial" | "align_temporal";

type PythonCommand = {
  bin: string;
  prefixArgs: string[];
};

function pythonCandidates(): PythonCommand[] {
  const configured = loadConfig().pythonBin.trim();
  const candidates: PythonCommand[] = [];
  const seen = new Set<string>();

  function push(bin: string, prefixArgs: string[] = []): void {
    const normalized = bin.trim();
    if (!normalized) return;
    const key = `${normalized}::${prefixArgs.join(" ")}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ bin: normalized, prefixArgs });
  }

  push(configured);
  if (process.platform === "win32") {
    push("python");
    push("py", ["-3"]);
    push("python3");
  } else {
    push("python3");
    push("python");
  }

  return candidates;
}

function isInterpreterLaunchFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|EACCES|EPERM|cannot access this file|not recognized/i.test(message);
}

function runWithInterpreter<T>(command: PythonCommand, script: string, task: PythonTask, payload: unknown, repoRoot: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(command.bin, [...command.prefixArgs, script, task], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    let stdout = "";
    let stderr = "";

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const succeed = (value: T): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      fail(new Error(`failed to start ${command.bin}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(stderr.trim() || `${command.bin} exited with code ${code}`));
        return;
      }
      try {
        succeed(JSON.parse(stdout) as T);
      } catch (error) {
        fail(new Error(`invalid python json: ${(error as Error).message}\n${stdout}\n${stderr}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function runPythonTask<T>(task: PythonTask, payload: unknown): Promise<T> {
  const repoRoot = getRepoRoot();
  const script = path.join(repoRoot, "algo", "algos", "demo_inference.py");

  let lastError: Error | null = null;
  for (const command of pythonCandidates()) {
    try {
      return await runWithInterpreter<T>(command, script, task, payload, repoRoot);
    } catch (error) {
      lastError = error as Error;
      if (!isInterpreterLaunchFailure(error)) break;
    }
  }

  throw lastError ?? new Error("python task failed");
}
