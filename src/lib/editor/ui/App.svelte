<script lang="ts">
  import Editor from "./Editor.svelte";
  import { createTauriHost } from "../host/tauriHost";

  const host = createTauriHost();
</script>

<Editor host={host} />

