// components/ui/sonner.jsx
// ============================================================
// Toast notifications using Sonner
// Clean, futuristic design from top-right
// ============================================================

import { Toaster as Sonner } from "sonner";

export function Toaster({ ...props }) {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position="top-right"
      expand={false}
      richColors={false}
      closeButton
      gap={8}
      toastOptions={{
        duration: 3000,
        classNames: {
          toast: `
            group toast
            !bg-slate-900/95 !backdrop-blur-sm
            !border !border-slate-700/50
            !rounded-lg !shadow-xl !shadow-black/20
            !py-2.5 !px-4 !min-h-0
            !text-sm !font-medium
            !flex !items-center !gap-3
          `,
          title: "!text-slate-100 !text-sm !font-medium !leading-tight",
          description: "!text-slate-400 !text-xs !mt-0.5 !leading-snug",
          actionButton: `
            !bg-slate-700 !text-slate-100 !text-xs !font-medium
            !px-2.5 !py-1 !rounded-md
            hover:!bg-slate-600
          `,
          cancelButton: `
            !bg-transparent !text-slate-400 !text-xs
            hover:!text-slate-200
          `,
          closeButton: `
            !bg-transparent !text-slate-500 !border-0
            hover:!text-slate-300
            !-right-1 !-top-1
          `,
          // Type-specific styling - clean accent colors
          success: `
            !border-l-2 !border-l-emerald-500
            [&_.sonner-icon]:!text-emerald-400
          `,
          error: `
            !border-l-2 !border-l-red-500
            [&_.sonner-icon]:!text-red-400
          `,
          info: `
            !border-l-2 !border-l-blue-500
            [&_.sonner-icon]:!text-blue-400
          `,
          warning: `
            !border-l-2 !border-l-amber-500
            [&_.sonner-icon]:!text-amber-400
          `,
          loading: `
            !border-l-2 !border-l-slate-500
            [&_.sonner-icon]:!text-slate-400
          `,
        },
      }}
      {...props}
    />
  );
}

// Re-export toast with custom default options
export { toast } from "sonner";
