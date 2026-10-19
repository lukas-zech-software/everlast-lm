import { SOURCE_LIMIT_REACHED_MESSAGE } from "@everlast/contracts";

export interface PinboardNote {
  id: string;
  display_order: number;
  content_md: string;
}

export function orderNotes<T extends { display_order: number }>(notes: T[]): T[] {
  return [...notes].sort((a, b) => a.display_order - b.display_order);
}

export type ConversionState = { enabled: true } | { enabled: false; tooltip: string };

/** FR-NM-03: conversion is disabled for empty bodies or a full source quota. */
export function conversionState(notes: PinboardNote[], slots: { used: number; limit: number }): ConversionState {
  if (slots.used >= slots.limit) return { enabled: false, tooltip: SOURCE_LIMIT_REACHED_MESSAGE };
  if (notes.length === 0 || notes.every((n) => n.content_md.trim() === "")) {
    return { enabled: false, tooltip: "Add note content to convert" };
  }
  return { enabled: true };
}

export function togglePinboardSelection(selected: string[], noteId: string, max: number): string[] {
  if (selected.includes(noteId)) return selected.filter((id) => id !== noteId);
  return selected.length >= max ? selected : [...selected, noteId];
}
