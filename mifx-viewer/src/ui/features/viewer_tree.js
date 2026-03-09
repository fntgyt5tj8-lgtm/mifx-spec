// src/ui/features/viewer_tree.js
import { state } from "../../app/state.js";

function _ensureTreeState() {
  const t = (state.tree ??= {});
  t.expanded ??= {};
  t.visible ??= {};
  return t;
}

function _treeKey(...parts) {
  return parts.filter(Boolean).join(":");
}

function _isExpanded(key, fallback = false) {
  const t = _ensureTreeState();
  return typeof t.expanded[key] === "boolean" ? t.expanded[key] : !!fallback;
}

function _setExpanded(key, value) {
  const t = _ensureTreeState();
  t.expanded[key] = !!value;
}

function _toggleExpanded(key, fallback = false) {
  _setExpanded(key, !_isExpanded(key, fallback));
}

function _collapseAllOperationNodes() {
  const t = _ensureTreeState();
  for (const k of Object.keys(t.expanded || {})) {
    if (k.startsWith("op:")) t.expanded[k] = false;
  }
}

function _isVisible(key, fallback = true) {
  const t = _ensureTreeState();
  return typeof t.visible[key] === "boolean" ? t.visible[key] : !!fallback;
}

function _setVisible(key, value) {
  const t = _ensureTreeState();
  t.visible[key] = !!value;
}

function _getSetupRefs() {
  return Array.isArray(state.job?.setups) ? state.job.setups : [];
}

function _getSetupPayloads() {
  return Array.isArray(state.setups) ? state.setups : [];
}

function _getActiveSetupPayload() {
  const id = state.activeSetupId;
  if (!id) return null;

  const setups = _getSetupPayloads();
  return setups.find((s) => s?.id === id) || null;
}

function _getViewerOps() {
  return (state.operations || []).filter((op) => op.setupRef === state.activeSetupId);
}

function _getSetupArtifacts(setup) {
  const arts = Array.isArray(setup?.artifacts) ? setup.artifacts : [];
  return arts.filter((a) => a && typeof a === "object" && a.path);
}

function _treeRow({
  host,
  depth = 0,
  caret = "",
  label = "",
  bold = false,
  accent = false,
  checkbox = null,
  onToggle = null,
  onClick = null,
}) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "6px";
  row.style.padding = "2px 0";
  row.style.paddingLeft = `${depth * 16}px`;

  const caretBtn = document.createElement("button");
  caretBtn.type = "button";
  caretBtn.textContent = caret || "•";
  caretBtn.style.border = "none";
  caretBtn.style.background = "transparent";
  caretBtn.style.padding = "0";
  caretBtn.style.margin = "0";
  caretBtn.style.width = "16px";
  caretBtn.style.cursor = onClick ? "pointer" : "default";
  caretBtn.style.opacity = caret ? "1" : "0.35";

  if (onClick) {
    caretBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  } else {
    caretBtn.disabled = true;
  }

  row.appendChild(caretBtn);

  if (checkbox) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checkbox.checked;
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      onToggle?.(cb.checked);
    });
    row.appendChild(cb);
  } else {
    const spacer = document.createElement("div");
    spacer.style.width = "13px";
    row.appendChild(spacer);
  }

  const text = document.createElement("div");
  text.textContent = label;
  text.style.cursor = onClick ? "pointer" : "default";
  text.style.userSelect = "none";
  if (bold) text.style.fontWeight = "600";
  if (accent) text.style.color = "#ff5500";

  if (onClick) {
    text.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  }

  row.appendChild(text);
  host.appendChild(row);
}

export function viewerTreeRender({
  hostId = "viewerSidebar",
  onSetupChange = null,
  onSelectOp = null,
} = {}) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const setupRefs = _getSetupRefs();
  const setup = _getActiveSetupPayload();
  const ops = _getViewerOps();
  const artifacts = _getSetupArtifacts(setup);

  host.innerHTML = `
    <div style="margin-bottom:12px;">
      <label for="viewerSetupSelect"><b>Setup</b></label>
      <div style="margin-top:6px;">
        <select id="viewerSetupSelect" style="width:100%;">
          ${setupRefs
            .map(
              (s) =>
                `<option value="${String(s.id)}"${
                  s.id === state.activeSetupId ? " selected" : ""
                }>${s.name || s.id}</option>`
            )
            .join("")}
        </select>
      </div>
    </div>

    <div id="viewerTreeRoot"></div>
  `;

  const select = document.getElementById("viewerSetupSelect");
  if (select) {
    select.addEventListener("change", async (e) => {
      const newSetupId = e.target.value || null;
      state.activeSetupId = newSetupId;

      const setupOps = (state.operations || []).filter((op) => op.setupRef === newSetupId);
      if (!setupOps.some((op) => op.id === state.activeOpId)) {
        state.activeOpId = null;
        state.renderer?.setActiveOperation?.(null);
      }

      _collapseAllOperationNodes();

      if (typeof onSetupChange === "function") {
        await onSetupChange(newSetupId);
      }

      viewerTreeRender({ hostId, onSetupChange, onSelectOp });
    });
  }

  const tree = document.getElementById("viewerTreeRoot");
  if (!tree || !state.activeSetupId) return;

  const setupKey = _treeKey("setup", state.activeSetupId);
  const artsKey = _treeKey(setupKey, "artifacts");
  const opsKey = _treeKey(setupKey, "operations");

  const setupExpanded = _isExpanded(setupKey, true);
  const artsExpanded = _isExpanded(artsKey, true);
  const opsExpanded = _isExpanded(opsKey, true);

  _treeRow({
    host: tree,
    depth: 0,
    caret: setupExpanded ? "▼" : "▶",
    label: setup?.name || state.activeSetupId,
    bold: true,
    onClick: () => {
      _collapseAllOperationNodes();
      _toggleExpanded(setupKey, true);
      viewerTreeRender({ hostId, onSetupChange, onSelectOp });
    },
  });

  if (!setupExpanded) return;

  _treeRow({
    host: tree,
    depth: 1,
    caret: artsExpanded ? "▼" : "▶",
    label: "Artifacts",
    bold: true,
    onClick: () => {
      _collapseAllOperationNodes();
      _toggleExpanded(artsKey, true);
      viewerTreeRender({ hostId, onSetupChange, onSelectOp });
    },
  });

  if (artsExpanded) {
    if (!artifacts.length) {
      _treeRow({
        host: tree,
        depth: 2,
        label: "No artifacts",
      });
    }

    for (const art of artifacts) {
      const role = String(art?.role || "artifact").trim().toLowerCase();
      const artifactKey = _treeKey(setupKey, "artifact", role);
      const artifactExpanded = _isExpanded(artifactKey, false);
      const artifactVisibleKey = _treeKey(artifactKey, "visible");
      const artifactCsysVisibleKey = _treeKey(artifactKey, "csys");

      _treeRow({
        host: tree,
        depth: 2,
        caret: artifactExpanded ? "▼" : "▶",
        label: role,
        checkbox: {
          checked: _isVisible(artifactVisibleKey, true),
        },
        onToggle: (checked) => {
          _setVisible(artifactVisibleKey, checked);
          state.renderer?.setSetupArtifactVisible?.(state.activeSetupId, role, checked);
        },
        onClick: () => {
          _collapseAllOperationNodes();
          _toggleExpanded(artifactKey, false);
          viewerTreeRender({ hostId, onSetupChange, onSelectOp });
        },
      });

      if (artifactExpanded) {
        _treeRow({
          host: tree,
          depth: 3,
          label: "CSYS",
          checkbox: {
            checked: _isVisible(artifactCsysVisibleKey, false),
          },
          onToggle: (checked) => {
            _setVisible(artifactCsysVisibleKey, checked);
            state.renderer?.setArtifactCsysVisible?.(state.activeSetupId, role, checked);
          },
        });
      }
    }
  }

  _treeRow({
    host: tree,
    depth: 1,
    caret: opsExpanded ? "▼" : "▶",
    label: "Operations",
    bold: true,
    onClick: () => {
      _collapseAllOperationNodes();
      _toggleExpanded(opsKey, true);
      viewerTreeRender({ hostId, onSetupChange, onSelectOp });
    },
  });

  if (opsExpanded) {
    if (!ops.length) {
      _treeRow({
        host: tree,
        depth: 2,
        label: "No operations",
      });
    }

    for (const op of ops) {
      const opKey = _treeKey("op", op.id);
      const opExpanded = _isExpanded(opKey, false);
      const toolpathVisibleKey = _treeKey(opKey, "toolpath");
      const csysVisibleKey = _treeKey(opKey, "csys");

      _treeRow({
        host: tree,
        depth: 2,
        caret: opExpanded ? "▼" : "▶",
        label: op.name || op.id,
        bold: state.activeOpId === op.id,
        accent: state.activeOpId === op.id,
        onClick: () => {
          _collapseAllOperationNodes();
          _setExpanded(opKey, true);
          onSelectOp?.(op.id);
          viewerTreeRender({ hostId, onSetupChange, onSelectOp });
        },
      });

      if (opExpanded) {
        _treeRow({
          host: tree,
          depth: 3,
          label: "toolpath",
          checkbox: {
            checked: _isVisible(toolpathVisibleKey, true),
          },
          onToggle: (checked) => {
            _setVisible(toolpathVisibleKey, checked);
            state.renderer?.setOperationToolpathVisible?.(op.id, checked);
          },
        });

        _treeRow({
          host: tree,
          depth: 3,
          label: "operation_csys",
          checkbox: {
            checked: _isVisible(csysVisibleKey, true),
          },
          onToggle: (checked) => {
            _setVisible(csysVisibleKey, checked);
            state.renderer?.setOperationCsysVisible?.(op.id, checked);
          },
        });
      }
    }
  }
}