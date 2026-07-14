import React from "react";

export function FormField({
  label, hint, required, error, children,
}: {
  label: string; hint?: string; required?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1.5">
        {label}{required && <span className="text-primary ml-0.5">*</span>}
        {hint && <span className="font-normal text-muted-foreground ml-1.5 text-xs">{hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}
    </div>
  );
}

export function FInput({ className = "", style, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-4 py-3 rounded-xl bg-secondary border border-border text-base text-foreground placeholder:text-muted-foreground/55 outline-none focus:border-primary transition-colors ${className}`}
      style={{ ...style, fontSize: 16 }}
    />
  );
}
