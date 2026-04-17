<script lang="ts">
  import { Copy, Trash2, ArrowUpToLine, ArrowDownToLine, TextCursor } from "lucide-svelte";

  let {
    open,
    x,
    y,
    canEditText,
    onClose,
    onDelete,
    onDuplicate,
    onBringToFront,
    onSendToBack,
    onEditText,
  }: {
    open: boolean;
    x: number;
    y: number;
    canEditText: boolean;
    onClose: () => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onBringToFront: () => void;
    onSendToBack: () => void;
    onEditText: () => void;
  } = $props();
</script>

{#if open}
  <button
    type="button"
    class="fixed inset-0 z-[1200] cursor-default"
    aria-label="Close context menu"
    onclick={() => onClose()}
  ></button>
  <div class="dropdown dropdown-open absolute z-[1201]" style={`left:${x}px;top:${y}px;`}>
    <ul class="menu bg-base-100 rounded-box w-56 shadow border border-base-300 p-1">
      <li>
        <button
          class="flex w-full items-center gap-2 text-error hover:bg-error/10"
          onclick={() => {
            onDelete();
            onClose();
          }}
        >
          <Trash2 class="size-4 shrink-0 opacity-90" />
          Delete
        </button>
      </li>
      <li>
        <button
          class="flex w-full items-center gap-2"
          onclick={() => {
            onDuplicate();
            onClose();
          }}
        >
          <Copy class="size-4 shrink-0 opacity-70" />
          Duplicate
        </button>
      </li>
      <li>
        <button
          class="flex w-full items-center gap-2"
          onclick={() => {
            onBringToFront();
            onClose();
          }}
        >
          <ArrowUpToLine class="size-4 shrink-0 opacity-70" />
          Bring to front
        </button>
      </li>
      <li>
        <button
          class="flex w-full items-center gap-2"
          onclick={() => {
            onSendToBack();
            onClose();
          }}
        >
          <ArrowDownToLine class="size-4 shrink-0 opacity-70" />
          Send to back
        </button>
      </li>
      <li>
        <button
          class="flex w-full items-center gap-2"
          disabled={!canEditText}
          onclick={() => {
            onEditText();
            onClose();
          }}
        >
          <TextCursor class="size-4 shrink-0 opacity-70" />
          Edit text
        </button>
      </li>
    </ul>
  </div>
{/if}
