"use client";

import { useEffect, useState } from "react";
import { getAdminKey, setAdminKey } from "@/lib/api";

/** Lets an operator provide the API key for admin actions (kept in sessionStorage only). */
export function AdminKey() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(getAdminKey());
  }, []);

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        setAdminKey(value.trim());
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }}
    >
      <label htmlFor="admin-key" className="block text-[11px] uppercase tracking-wider text-muted">
        Admin API key
      </label>
      <div className="flex gap-1.5">
        <input
          id="admin-key"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="for admin actions"
          className="min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 py-1 text-xs"
        />
        <button className="rounded-md border border-line bg-panel-2 px-2 text-xs hover:bg-line/60">
          {saved ? "Saved" : "Set"}
        </button>
      </div>
    </form>
  );
}
