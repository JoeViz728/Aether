import { Shield, Check, X } from 'lucide-react';
import { useAppStore } from '../store/app-store';

export function ApprovalModal() {
  const { pendingApprovals, resolveApproval } = useAppStore();
  const approval = pendingApprovals[0];

  if (!approval) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-aether-overlay" />
      <div className="relative w-full max-w-md rounded-2xl border border-amber-500/30 bg-aether-surface p-6 shadow-2xl animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <div className="rounded-full bg-amber-500/20 p-2">
            <Shield className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h2 className="font-semibold">{approval.title}</h2>
            <p className="text-xs text-aether-muted capitalize">{approval.type} approval required</p>
          </div>
        </div>

        <p className="text-sm text-aether-muted mb-4">{approval.description}</p>

        {approval.payload.reason && (
          <p className="text-sm mb-4 rounded-lg bg-aether-bg p-3 border border-aether-border">
            {approval.payload.reason}
          </p>
        )}

        {approval.payload.files && approval.payload.files.length > 0 && (
          <div className="mb-4 text-xs text-aether-muted">
            <p className="font-medium mb-1">Files to {approval.payload.files[0].action}:</p>
            <ul className="list-disc pl-4">
              {approval.payload.files.map((f, i) => (
                <li key={i}>{f.path}</li>
              ))}
            </ul>
          </div>
        )}

        {approval.payload.command && (
          <pre className="mb-4 rounded-lg bg-aether-bg p-3 text-xs overflow-x-auto border border-aether-border">
            {approval.payload.command}
          </pre>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => resolveApproval(approval.id, 'approved')}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-medium hover:bg-green-500 transition-colors"
          >
            <Check className="h-4 w-4" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => resolveApproval(approval.id, 'denied')}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-aether-border px-4 py-2.5 text-sm font-medium hover:bg-aether-surface-2 transition-colors"
          >
            <X className="h-4 w-4" />
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}