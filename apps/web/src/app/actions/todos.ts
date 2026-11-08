"use server";

import { runAction } from "@/server/action";
import * as todos from "@vistoo/backend/services/todos";
import { createTodoSchema, reorderTodosSchema, updateTodoSchema } from "@vistoo/domain/todos";
import { idSchema } from "@vistoo/domain/validation";

export async function createTodoAction(input: unknown) {
  return runAction(createTodoSchema, input, (ctx, data) => todos.createTodo(ctx, data));
}

export async function updateTodoAction(input: unknown) {
  return runAction(updateTodoSchema, input, (ctx, data) => todos.updateTodo(ctx, data));
}

export async function deleteTodoAction(input: unknown) {
  return runAction(idSchema, input, (ctx, data) => todos.deleteTodo(ctx, data.id));
}

export async function reorderTodosAction(input: unknown) {
  return runAction(reorderTodosSchema, input, (ctx, data) => todos.reorderTodos(ctx, data));
}
