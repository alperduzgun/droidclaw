import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export type TodoStatus = "pending" | "completed" | "failed";

export interface TodoItem {
  id: string;
  goal: string;
  normalizedGoal: string;
  status: TodoStatus;
  createdAt: string;
  updatedAt: string;
  completionNote?: string;
  failureNote?: string;
  runCount: number;
}

interface TodoStoreData {
  version: 1;
  todos: TodoItem[];
}

function normalizeGoal(goal: string): string {
  return goal.toLowerCase().replace(/\s+/g, " ").trim();
}

function createEmptyStore(): TodoStoreData {
  return { version: 1, todos: [] };
}

export class TodoStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  beginGoal(goal: string): { todo: TodoItem; duplicateCompleted: TodoItem[] } {
    const data = this.read();
    const normalizedGoal = normalizeGoal(goal);
    const now = new Date().toISOString();

    const existing = data.todos.find((todo) => todo.normalizedGoal === normalizedGoal);
    const duplicateCompleted = data.todos.filter(
      (todo) => todo.normalizedGoal === normalizedGoal && todo.status === "completed"
    );

    if (existing) {
      existing.status = "pending";
      existing.updatedAt = now;
      existing.runCount += 1;
      existing.failureNote = undefined;
      this.write(data);
      return { todo: existing, duplicateCompleted };
    }

    const todo: TodoItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      goal,
      normalizedGoal,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      runCount: 1,
    };

    data.todos.unshift(todo);
    this.write(data);
    return { todo, duplicateCompleted };
  }

  completeGoal(id: string, note?: string): void {
    const data = this.read();
    const todo = data.todos.find((item) => item.id === id);
    if (!todo) return;

    todo.status = "completed";
    todo.updatedAt = new Date().toISOString();
    todo.completionNote = note;
    todo.failureNote = undefined;
    this.write(data);
  }

  failGoal(id: string, note?: string): void {
    const data = this.read();
    const todo = data.todos.find((item) => item.id === id);
    if (!todo) return;

    todo.status = "failed";
    todo.updatedAt = new Date().toISOString();
    todo.failureNote = note;
    this.write(data);
  }

  listTodos(): TodoItem[] {
    return this.read().todos;
  }

  buildPromptContext(goal: string, currentTodoId: string): string {
    const data = this.read();
    const normalizedGoal = normalizeGoal(goal);
    const exactMatches = data.todos
      .filter((todo) => todo.normalizedGoal === normalizedGoal && todo.id !== currentTodoId)
      .slice(0, 5);
    const recentCompleted = data.todos
      .filter((todo) => todo.status === "completed" && todo.normalizedGoal !== normalizedGoal)
      .slice(0, 5);

    const lines: string[] = [
      `CURRENT_TODO_ID: ${currentTodoId}`,
      "Use todo memory to avoid repeating work that is already marked completed unless the current goal explicitly asks for a rerun.",
    ];

    if (exactMatches.length > 0) {
      lines.push("MATCHING_TODOS:");
      for (const todo of exactMatches) {
        lines.push(
          `- [${todo.status}] ${todo.goal} | updated=${todo.updatedAt} | runs=${todo.runCount}`
        );
      }
    }

    if (recentCompleted.length > 0) {
      lines.push("RECENT_COMPLETED_TODOS:");
      for (const todo of recentCompleted) {
        lines.push(`- ${todo.goal} | updated=${todo.updatedAt}`);
      }
    }

    return lines.join("\n");
  }

  private read(): TodoStoreData {
    if (!existsSync(this.filePath)) {
      return createEmptyStore();
    }

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as TodoStoreData;
      if (!parsed.todos || !Array.isArray(parsed.todos)) {
        return createEmptyStore();
      }
      return parsed;
    } catch {
      return createEmptyStore();
    }
  }

  private write(data: TodoStoreData): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }
}
