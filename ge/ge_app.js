/* ═══════════════════════════════════════════════════════════════════════════
   BIOLAB ENGINE v4 — Módulo GE (Genética) — v2
   ───────────────────────────────────────────────────────────────────────────
   ARQUITECTURA DE DATOS
   ─────────────────────
   • nodes[]   → fuente de verdad. Árbol por parentId.
                 Tipos: 'species' | 'strain' | 'phenotype'
                 Estado: node.status = 'active' | 'archived'  (default: 'active')
   • records[] → auditoría inmutable. Nunca se usa para render.

   ESTADO (node.status)
   ────────────────────
   Independiente por nodo. Sin cascada.
   Un fenotipo activo hijo de una cepa archivada SÍ es seleccionable:
   la línea evolucionó, el padre puede estar archivado sin afectar a los hijos.
   getSelectableGenetics() filtra únicamente por el status del nodo en sí.

   ÍNDICES EN MEMORIA (nunca persisten, siempre sincronizados)
   ────────────────────────────────────────────────────────────
   • idx.byId        Map<id, Node>          — lookup O(1)
   • idx.children    Map<parentKey, Node[]> — hijos directos O(1)
   • idx.descendants Map<id, Set<id>>       — todos los descendientes O(1)
   Reconstruidos ÚNICAMENTE en: createNode, deleteNode, importJSON, resetAll.

   PERSISTENCIA
   ────────────
   save() solo en operaciones que modifican datos.
   NUNCA en cambios de UI (selectNode, toggleCollapse, setSearch, setView).

   RENDER GRANULAR (funciones explícitas, sin strings mágicos)
   ────────────────────────────────────────────────────────────
   • renderStats()   → header con conteos
   • renderTree()    → árbol ASCII
   • renderPanel()   → panel lateral del nodo seleccionado
   • renderCatalog() → tabla activos/archivados (vista Catálogo)
   • renderAll()     → stats + vista activa completa

   Mapa caller → targets:
   createNode/deleteNode     → renderAll()
   setNodeStatus             → statsCache=null + renderTree() + renderPanel() + renderCatalog()
   updateNode                → renderStats() + renderTree() + renderPanel()
   addNota/removeNota        → renderStats() + renderTree() + renderPanel()
   addImage/removeImage      → renderStats() + renderTree() + renderPanel()
   selectNode                → renderTree() + renderPanel()
   toggleCollapse/search     → renderTree()
   setView                   → renderAll()

   STATS CACHE
   ───────────
   statsCache: null = inválido. Se invalida en rebuildAllIndexes() y en
   toda operación que modifica conteos (notas, imágenes, status).

   API PÚBLICA (contrato con CI y otros módulos)
   ─────────────────────────────────────────────
   getSelectableGenetics() → solo nodos activos seleccionables. Sin cambio de firma.

   CONTRATO DEL MÓDULO (BIOLAB_SYSTEM.md §4)
   ──────────────────────────────────────────
   • IIFE                  ✓
   • window.ge             ✓
   • window.GEInit         ✓
   • window.onModuleUnload ✓
   • Listeners en variables, limpiados en unload ✓
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. CONSTANTES
  // ═══════════════════════════════════════════════════════════════════════════

  const LS_KEY      = 'biolab.ge.v4';
  const RECORDS_CAP = 2000;
  const HISTORY_CAP = 500;

  const NOTA_ESTADOS = ['normal', 'positivo', 'atencion', 'peligro'];
  const NOTA_ORDER   = { peligro: 4, atencion: 3, positivo: 2, normal: 1 };

  // Valores válidos de status. Extensible en el futuro sin romper nada.
  const NODE_STATUSES = ['active', 'archived'];

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const state = {
    nodes:   [],
    records: [],
    ui: {
      selectedId: null,
      collapsed:  new Set(),
      search:     '',
      // Vistas: 'tree' | 'catalog' | 'api' | 'history' | 'config'
      view:       'tree',
      modal:      null,   // { mode, type, parentId, nodeId }
      lightbox:   null    // { nodeId, index }
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ÍNDICES + STATS CACHE
  // ═══════════════════════════════════════════════════════════════════════════

  const idx = {
    byId:        new Map(),
    children:    new Map(),
    descendants: new Map()
  };

  // null = inválido (recalcular). Se invalida en rebuildAllIndexes() y en
  // cualquier operación que cambia conteos (status, notas, imágenes).
  let statsCache = null;

  /**
   * Reconstruye los tres índices y limpia statsCache.
   * O(n) — una pasada para byId+children, una pasada bottom-up para descendants.
   * Llamar SOLO cuando cambia la estructura padre-hijo del árbol.
   */
  function rebuildAllIndexes() {
    idx.byId.clear();
    idx.children.clear();
    idx.descendants.clear();
    statsCache = null;

    // Pasada 1: byId y children
    for (const node of state.nodes) {
      idx.byId.set(node.id, node);
      const key = node.parentId ?? '__root__';
      if (!idx.children.has(key)) idx.children.set(key, []);
      idx.children.get(key).push(node);
    }

    // Pasada 2: descendants — bottom-up con algoritmo topológico (Kahn inverso)
    // Cada nodo se procesa exactamente una vez → O(n) total
    const pending = new Map();
    for (const node of state.nodes) {
      if (!pending.has(node.id)) pending.set(node.id, 0);
      if (node.parentId) pending.set(node.parentId, (pending.get(node.parentId) ?? 0) + 1);
      idx.descendants.set(node.id, new Set());
    }

    const queue = [];
    for (const node of state.nodes) {
      if (pending.get(node.id) === 0) queue.push(node.id);
    }

    while (queue.length) {
      const id   = queue.shift();
      const node = idx.byId.get(id);
      if (!node?.parentId) continue;
      const pid  = node.parentId;
      const pSet = idx.descendants.get(pid);
      if (pSet) {
        pSet.add(id);
        for (const dId of idx.descendants.get(id)) pSet.add(dId);
      }
      const rem = pending.get(pid) - 1;
      pending.set(pid, rem);
      if (rem === 0) queue.push(pid);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. UTILIDADES
  // ═══════════════════════════════════════════════════════════════════════════

  const uid = (prefix = 'NODE') =>
    `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const nowIso = () => new Date().toISOString();

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const typeLabel    = (t) => ({ species: 'Especie', strain: 'Cepa', phenotype: 'Fenotipo' }[t] ?? t);
  const defaultIcon  = (t) => ({ species: 'SP.',     strain: 'CE.',  phenotype: 'FT.' }[t]      ?? 'N.');
  const defaultColor = (t) => ({ species: '#70AD47', strain: '#7C6FFF', phenotype: '#44AAFF' }[t] ?? '#888');

  const placeholderFor = (t) =>
    t === 'species' ? 'ej: Psilocybe cubensis' : t === 'strain' ? 'ej: APE' : 'ej: APE Rework';

  function setTxt(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ACCESO AL ÁRBOL — siempre via índices
  // ═══════════════════════════════════════════════════════════════════════════

  const getNode          = (id)  => idx.byId.get(id) ?? null;
  const getChildren      = (pid) => idx.children.get(pid) ?? [];
  const getRoots         = ()    => idx.children.get('__root__') ?? [];
  const getDescendantIds = (id)  => [...(idx.descendants.get(id) ?? [])];

  /** Cadena de ancestros desde la raíz hasta el nodo inclusive. O(depth). */
  function getAncestors(id) {
    const chain = [];
    let cur = getNode(id);
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? getNode(cur.parentId) : null;
    }
    return chain;
  }

  /** Linaje resuelto: speciesId, strainId, phenotypeId más cercanos + path. */
  function resolveLineage(nodeId) {
    const chain   = getAncestors(nodeId);
    const lineage = {
      speciesId: null, strainId: null, phenotypeId: null,
      path: chain.map((n) => ({ id: n.id, type: n.type, name: n.name, icon: n.icon, color: n.color, status: n.status }))
    };
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i];
      if (n.type === 'phenotype' && !lineage.phenotypeId) lineage.phenotypeId = n.id;
      if (n.type === 'strain'    && !lineage.strainId)    lineage.strainId    = n.id;
      if (n.type === 'species'   && !lineage.speciesId)   lineage.speciesId   = n.id;
    }
    return lineage;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. REGLAS DE JERARQUÍA
  // ═══════════════════════════════════════════════════════════════════════════

  function canHaveChildOfType(parentNode, childType) {
    if (!parentNode)                     return childType === 'species';
    if (parentNode.type === 'species')   return childType === 'strain';
    if (parentNode.type === 'strain')    return childType === 'phenotype';
    if (parentNode.type === 'phenotype') return childType === 'phenotype' || childType === 'strain';
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. PERSISTENCIA
  // ═══════════════════════════════════════════════════════════════════════════

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        nodes:   state.nodes,
        records: state.records,
        ui: {
          selectedId: state.ui.selectedId,
          collapsed:  [...state.ui.collapsed]
        }
      }));
    } catch (e) {
      console.warn('[GE] save() falló:', e);
      toast('No se pudo guardar (¿localStorage lleno?)', 'err');
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      state.nodes   = Array.isArray(p.nodes)   ? p.nodes   : [];
      state.records = Array.isArray(p.records)  ? p.records : [];
      if (p.ui) {
        if (p.ui.selectedId)               state.ui.selectedId = p.ui.selectedId;
        if (Array.isArray(p.ui.collapsed)) state.ui.collapsed  = new Set(p.ui.collapsed);
      }
      // Migración defensiva: nodos sin status reciben 'active'
      for (const n of state.nodes) {
        if (!NODE_STATUSES.includes(n.status)) n.status = 'active';
      }
    } catch (e) {
      console.warn('[GE] load() falló:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. AUDITORÍA
  // ═══════════════════════════════════════════════════════════════════════════

  function logRecord(action, node, details = {}) {
    state.records.unshift({
      id: uid('LOG'), action,
      nodeId: node.id, nodeType: node.type, nodeName: node.name,
      nodeStatus: node.status,
      timestamp: nowIso(), details
    });
    if (state.records.length > RECORDS_CAP) state.records.length = RECORDS_CAP;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. CRUD
  //
  //    Regla:
  //    • Cambio de estructura → rebuildAllIndexes() + save()  (statsCache queda null)
  //    • Cambio de contenido  → statsCache = null + save()    (índices siguen válidos)
  // ═══════════════════════════════════════════════════════════════════════════

  function createNode({ type, parentId, name, icon, color, descripcion }) {
    const parent = parentId ? getNode(parentId) : null;
    if (parentId && !parent)
      throw new Error('Padre inexistente');
    if (!canHaveChildOfType(parent, type))
      throw new Error(`No se permite '${typeLabel(type)}' bajo '${parent ? typeLabel(parent.type) : 'raíz'}'`);

    const node = {
      id:          uid('NODE'),
      type,
      parentId:    parentId || null,
      name:        (name        || '').trim(),
      descripcion: (descripcion || '').trim(),
      icon:        icon  || defaultIcon(type),
      color:       color || defaultColor(type),
      status:      'active',   // ← todos los nodos nacen activos
      notas:       [],
      imagenes:    [],
      createdAt:   nowIso(),
      updatedAt:   nowIso()
    };

    state.nodes.push(node);
    logRecord('CREATE', node, { parentId: node.parentId });
    rebuildAllIndexes();
    save();
    return node;
  }

  function updateNode(id, changes) {
    const n = getNode(id);
    if (!n) return null;

    // 'status' NO está en esta lista — tiene su propia función setNodeStatus()
    // para que cada cambio quede auditado con su propio action type.
    const allow   = ['name', 'icon', 'color', 'descripcion'];
    const applied = {};
    for (const k of allow) {
      if (changes[k] !== undefined && changes[k] !== n[k]) {
        applied[k] = { from: n[k], to: changes[k] };
        n[k] = changes[k];
      }
    }
    n.updatedAt = nowIso();
    if (Object.keys(applied).length) logRecord('UPDATE', n, { changes: applied });
    // Sin rebuildAllIndexes(): parentId no cambió.
    // Sin statsCache=null: nombre/color/desc no cambian conteos del header.
    save();
    return n;
  }

  /**
   * Cambia el status de un nodo individual. Sin cascada.
   * Un fenotipo activo hijo de una cepa archivada sigue siendo seleccionable.
   */
  function setNodeStatus(id, newStatus) {
    if (!NODE_STATUSES.includes(newStatus)) return;
    const n = getNode(id);
    if (!n || n.status === newStatus) return;
    const prevStatus = n.status;
    n.status    = newStatus;
    n.updatedAt = nowIso();
    logRecord(newStatus === 'archived' ? 'ARCHIVE' : 'RESTORE', n, { from: prevStatus });
    statsCache = null;   // los conteos de activos/archivados cambiaron
    save();
  }

  function deleteNode(id) {
    const n = getNode(id);
    if (!n) return;

    const idsToDelete = new Set([id, ...getDescendantIds(id)]);
    for (const did of idsToDelete) {
      const nd = getNode(did);
      if (nd) logRecord('DELETE', nd, { cascade: did !== id });
    }

    state.nodes = state.nodes.filter((x) => !idsToDelete.has(x.id));
    if (state.ui.selectedId && idsToDelete.has(state.ui.selectedId)) {
      state.ui.selectedId = null;
    }

    rebuildAllIndexes();
    save();
  }

  // ── Notas ──────────────────────────────────────────────────────────────────

  function addNota(nodeId, { texto, estado }) {
    const n = getNode(nodeId);
    if (!n) return null;
    const nota = {
      id:        uid('NOTA'),
      texto:     (texto || '').trim(),
      estado:    NOTA_ESTADOS.includes(estado) ? estado : 'normal',
      createdAt: nowIso()
    };
    n.notas.push(nota);
    n.updatedAt = nowIso();
    logRecord('NOTE_ADD', n, { notaId: nota.id, estado: nota.estado });
    statsCache = null;
    save();
    return nota;
  }

  function removeNota(nodeId, notaId) {
    const n = getNode(nodeId);
    if (!n) return;
    const before = n.notas.length;
    n.notas = n.notas.filter((x) => x.id !== notaId);
    if (n.notas.length !== before) {
      n.updatedAt = nowIso();
      logRecord('NOTE_REMOVE', n, { notaId });
      statsCache = null;
      save();
    }
  }

  // ── Imágenes ────────────────────────────────────────────────────────────────

  function addImage(nodeId, { dataUrl, name }) {
    const n = getNode(nodeId);
    if (!n) return null;
    const img = { id: uid('IMG'), dataUrl, name: name || 'image', createdAt: nowIso() };
    n.imagenes.push(img);
    n.updatedAt = nowIso();
    logRecord('IMAGE_ADD', n, { imageId: img.id, name: img.name });
    statsCache = null;
    save();
    return img;
  }

  function removeImage(nodeId, imgId) {
    const n = getNode(nodeId);
    if (!n) return;
    const before = n.imagenes.length;
    n.imagenes = n.imagenes.filter((x) => x.id !== imgId);
    if (n.imagenes.length !== before) {
      n.updatedAt = nowIso();
      logRecord('IMAGE_REMOVE', n, { imageId: imgId });
      statsCache = null;
      save();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. API PÚBLICA DE DATOS — getSelectableGenetics()
  //     Contrato con CI y otros módulos. No cambiar firma ni formato de retorno.
  //
  //     Seleccionables: nodos ACTIVOS que son phenotype, o strain sin hijos.
  //     Un fenotipo activo hijo de una cepa archivada SÍ aparece aquí.
  //     La exclusión es solo por el status del nodo en sí.
  // ═══════════════════════════════════════════════════════════════════════════

  function getSelectableGenetics() {
    return state.nodes
      .filter((n) => {
        if (n.status === 'archived') return false;             // excluir archivados
        if (n.type === 'species')    return false;             // species nunca seleccionable
        if (n.type === 'phenotype')  return true;
        if (n.type === 'strain')     return getChildren(n.id).length === 0;  // O(1)
        return false;
      })
      .map((n) => {
        const lin  = resolveLineage(n.id);
        const sp   = lin.speciesId ? getNode(lin.speciesId) : null;
        const st   = lin.strainId  ? getNode(lin.strainId)  : null;
        const parts = [];
        if (sp) parts.push(sp.name);
        if (st && st.id !== n.id) parts.push(st.name);
        parts.push(n.name);
        return {
          id:          n.id,
          label:       parts.join(' / '),
          type:        n.type,
          status:      n.status,
          speciesId:   lin.speciesId,
          strainId:    lin.strainId,
          phenotypeId: n.type === 'phenotype' ? n.id : null,
          lineage:     lin.path,
          createdAt:   n.createdAt
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. BÚSQUEDA OPTIMIZADA — O(n) precomputación antes del render
  // ═══════════════════════════════════════════════════════════════════════════

  function computeSearchSets(q) {
    if (!q) return { selfMatch: null, visible: null };
    const selfMatch = new Set();
    const visible   = new Set();
    for (const node of state.nodes) {
      if (node.name.toLowerCase().includes(q)) {
        selfMatch.add(node.id);
        visible.add(node.id);
        let cur = node.parentId ? getNode(node.parentId) : null;
        while (cur) {
          if (visible.has(cur.id)) break;
          visible.add(cur.id);
          cur = cur.parentId ? getNode(cur.parentId) : null;
        }
      }
    }
    return { selfMatch, visible };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. RENDER — ÁRBOL ASCII
  // ═══════════════════════════════════════════════════════════════════════════

  function worstNotaEstado(notas) {
    let best = null;
    for (const nota of notas) {
      if (!best || NOTA_ORDER[nota.estado] > NOTA_ORDER[best]) best = nota.estado;
    }
    return best;
  }

  function buildAddButtons(node) {
    // No se pueden agregar hijos a nodos archivados
    if (node.status === 'archived') return '';
    const b = [];
    if (node.type === 'species') {
      b.push(`<button class="mini-btn" title="Añadir cepa" onclick="event.stopPropagation();ge.openCreate('strain','${node.id}')">+ CE.</button>`);
    } else if (node.type === 'strain') {
      b.push(`<button class="mini-btn" title="Añadir fenotipo" onclick="event.stopPropagation();ge.openCreate('phenotype','${node.id}')">+ FT.</button>`);
    } else if (node.type === 'phenotype') {
      b.push(`<button class="mini-btn"     title="Sub-fenotipo" onclick="event.stopPropagation();ge.openCreate('phenotype','${node.id}')">+ FT.</button>`);
      b.push(`<button class="mini-btn alt" title="Derivar cepa" onclick="event.stopPropagation();ge.openCreate('strain','${node.id}')">+ CE.</button>`);
    }
    return b.join('');
  }

  function buildAsciiLines(node, prefix, isLast, isRoot, selfMatch, visible) {
    if (visible && !visible.has(node.id)) return [];

    const children    = getChildren(node.id);
    const isCollapsed = state.ui.collapsed.has(node.id);
    const isSelected  = state.ui.selectedId === node.id;
    const hasChildren = children.length > 0;
    const isArchived  = node.status === 'archived';
    // dimmed por búsqueda (es ancestro pero no match directo)
    const dimmed      = selfMatch !== null && !selfMatch.has(node.id);

    const connector   = isRoot ? '' : (isLast ? '└── ' : '├── ');
    const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');

    const typeStr = node.type === 'species'
      ? node.name
      : node.type === 'strain'
        ? 'Cepa \u279C ' + node.name
        : 'Fenotipo \u279C ' + node.name;

    const w           = worstNotaEstado(node.notas);
    const dotHtml     = w                    ? `<span class="badge-dot dot-${w}" title="estado:${w}"></span>` : '';
    const notesTxt    = node.notas.length    ? ` <span class="badge-count">N:${node.notas.length}</span>` : '';
    const imgsTxt     = node.imagenes.length ? ` <span class="badge-count">I:${node.imagenes.length}</span>` : '';
    // Badge de archivado — solo en el nodo archivado, no se propaga a hijos
    const archBadge   = isArchived ? ' <span class="badge-arch" title="Archivado">arch</span>' : '';
    const collapseBtn = hasChildren
      ? `<span class="ascii-caret" onclick="ge.toggleCollapse(event,'${node.id}')" title="${isCollapsed ? 'Expandir' : 'Colapsar'}">${isCollapsed ? '▸' : '▾'}</span>`
      : '';

    const prefixHtml  = `<span class="ge-prefix">${esc(prefix)}${esc(connector)}</span>`;
    const labelHtml   = `<span class="ge-label ge-type-${node.type}${isArchived ? ' ge-archived' : ''}" style="color:${node.color}" ondblclick="ge.inlineEditStart(event,'${node.id}')" title="Doble click para editar nombre">${esc(typeStr)}</span>`;
    const actionsHtml = `<span class="ge-inline-actions">${collapseBtn}${buildAddButtons(node)}</span>`;

    const selClass = isSelected ? ' ge-sel' : '';
    const dimClass = dimmed     ? ' ge-dim' : '';

    const line = `<span class="ge-line${selClass}${dimClass}" data-id="${node.id}" onclick="ge.selectNode('${node.id}')">${prefixHtml}${labelHtml}${archBadge}${dotHtml}${notesTxt}${imgsTxt}${actionsHtml}</span>`;

    const lines = [line];

    // Descripción (↳)
    const desc = (node.descripcion || '').trim();
    if (desc) {
      const descIndent = isRoot ? '    ' : prefix + (isLast ? '    ' : '│   ') + '    ';
      for (const dl of desc.split('\n').filter(Boolean)) {
        lines.push(
          `<span class="ge-line ge-desc-line" data-id="${node.id}" onclick="ge.selectNode('${node.id}')">` +
          `<span class="ge-prefix ge-desc-prefix">${esc(descIndent)}↳ </span>` +
          `<span class="ge-desc-text">${esc(dl.trim())}</span>` +
          `</span>`
        );
      }
    }

    // Hijos (recursivo)
    if (!isCollapsed && hasChildren) {
      const sepPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
      lines.push(`<span class="ge-line ge-sep"><span class="ge-prefix">${esc(sepPrefix)}\u2502</span></span>`);
      const visibleChildren = visible ? children.filter((c) => visible.has(c.id)) : children;
      visibleChildren.forEach((child, i) => {
        const childIsLast = i === visibleChildren.length - 1;
        lines.push(...buildAsciiLines(child, childPrefix, childIsLast, false, selfMatch, visible));
        if (!childIsLast) {
          lines.push(`<span class="ge-line ge-sep"><span class="ge-prefix">${esc(childPrefix)}\u2502</span></span>`);
        }
      });
    }

    return lines;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. RENDER — TARGETS GRANULARES
  // ═══════════════════════════════════════════════════════════════════════════

  function renderStats() {
    if (!statsCache) {
      const c = { species: 0, strain: 0, phenotype: 0, archived: 0 };
      for (const n of state.nodes) {
        if (c[n.type] !== undefined) c[n.type]++;
        if (n.status === 'archived') c.archived++;
      }
      statsCache = {
        species:    c.species,
        strains:    c.strain,
        phenotypes: c.phenotype,
        archived:   c.archived,
        records:    state.records.length,
        selectable: getSelectableGenetics().length
      };
    }
    setTxt('hdr-species',    statsCache.species);
    setTxt('hdr-strains',    statsCache.strains);
    setTxt('hdr-phenotypes', statsCache.phenotypes);
    setTxt('hdr-archived',   statsCache.archived);
    setTxt('hdr-records',    statsCache.records);
    setTxt('hdr-selectable', statsCache.selectable);
  }

  function renderTree() {
    const root  = document.getElementById('ge-tree');
    if (!root) return;
    const roots = getRoots();

    if (!roots.length) {
      root.innerHTML =
        '<div class="tree-empty">' +
        '<div class="tree-empty-t">Árbol genético vacío</div>' +
        '<div class="tree-empty-s">El árbol es la fuente de verdad de todo el sistema.<br>Comienza creando la primera especie.</div>' +
        '<button class="btn btn-primary" onclick="ge.openCreate(\'species\',null)">+ Nueva Especie</button>' +
        '</div>';
      return;
    }

    const q = (state.ui.search || '').trim().toLowerCase();
    const { selfMatch, visible } = computeSearchSets(q);

    const allLines = [];
    roots.forEach((rNode, ri) => {
      const isLastRoot = ri === roots.length - 1;
      allLines.push(...buildAsciiLines(rNode, '', isLastRoot, true, selfMatch, visible));
      if (!isLastRoot) {
        allLines.push('<span class="ge-line ge-sep"><span class="ge-prefix"> </span></span>');
      }
    });

    root.innerHTML = '<pre class="ge-ascii-tree">' + allLines.join('\n') + '</pre>';
  }

  function renderBreadcrumb(pathArr) {
    if (!pathArr?.length) return '<span class="bc-seg bc-root">raíz</span>';
    return pathArr.map((p, i) => {
      const last = i === pathArr.length - 1;
      const arch = p.status === 'archived' ? ' bc-archived' : '';
      return `<span class="bc-seg type-${p.type}${last ? ' bc-current' : ''}${arch}" style="--node-color:${p.color}">${esc(p.icon)} ${esc(p.name)}${arch ? ' <span class="bc-arch-tag">arch</span>' : ''}</span>`;
    }).join('<span class="bc-sep">›</span>');
  }

  function renderPanel() {
    const el = document.getElementById('ge-panel');
    if (!el) return;

    const node = state.ui.selectedId ? getNode(state.ui.selectedId) : null;

    if (!node) {
      el.innerHTML = `
        <div class="panel-empty">
          <div class="panel-empty-ico">👉</div>
          <div class="panel-empty-t">Selecciona un nodo del árbol</div>
          <div class="panel-empty-s">Haz click en cualquier rama para ver detalles, notas, imágenes y gestionar el estado del nodo.</div>
        </div>`;
      return;
    }

    const lin        = resolveLineage(node.id);
    const descCount  = idx.descendants.get(node.id)?.size ?? 0;
    const childCount = getChildren(node.id).length;
    const isArchived = node.status === 'archived';

    // Botones de acción del panel
    const actionBtns = [];
    if (!isArchived) {
      if (node.type === 'species')
        actionBtns.push(`<button class="btn btn-primary btn-sm" onclick="ge.openCreate('strain','${node.id}')">➕ Añadir cepa</button>`);
      if (node.type === 'strain')
        actionBtns.push(`<button class="btn btn-primary btn-sm" onclick="ge.openCreate('phenotype','${node.id}')">➕ Añadir fenotipo</button>`);
      if (node.type === 'phenotype') {
        actionBtns.push(`<button class="btn btn-primary btn-sm" onclick="ge.openCreate('phenotype','${node.id}')">➕ Sub-fenotipo</button>`);
        actionBtns.push(`<button class="btn btn-primary btn-sm" onclick="ge.openCreate('strain','${node.id}')">➕ Derivar cepa</button>`);
      }
    }
    actionBtns.push(`<button class="btn btn-secondary btn-sm" onclick="ge.openEdit('${node.id}')">✏️ Editar</button>`);
    // Archivar / Restaurar — el botón más importante del nuevo sistema
    if (isArchived) {
      actionBtns.push(`<button class="btn btn-restore btn-sm" onclick="ge.toggleNodeStatus('${node.id}')">♻️ Restaurar</button>`);
    } else {
      actionBtns.push(`<button class="btn btn-archive btn-sm" onclick="ge.toggleNodeStatus('${node.id}')">📦 Archivar</button>`);
    }
    actionBtns.push(`<button class="btn btn-danger btn-sm" onclick="ge.deleteCurrent()">🗑️ Eliminar</button>`);

    const notasHtml = node.notas.length
      ? node.notas.slice().reverse().map((nota) => `
          <div class="nota-item estado-${nota.estado}">
            <span class="nota-dot dot-${nota.estado}"></span>
            <div class="nota-body">
              <div class="nota-txt">${esc(nota.texto)}</div>
              <div class="nota-meta">${new Date(nota.createdAt).toLocaleString()}</div>
            </div>
            <button class="icon-btn" title="Eliminar" onclick="ge.removeNotaFromPanel('${nota.id}')">✕</button>
          </div>`).join('')
      : '<div class="empty-mini">Sin notas aún</div>';

    const imagenesHtml = node.imagenes.length
      ? node.imagenes.map((im, i) => `
          <div class="img-item">
            <img src="${im.dataUrl}" alt="${esc(im.name)}" onclick="ge.openLightbox('${node.id}',${i})" />
            <button class="img-del" onclick="ge.removeImageFromPanel('${im.id}')" title="Eliminar">✕</button>
            <div class="img-name">${esc(im.name)}</div>
          </div>`).join('')
      : '<div class="empty-mini">Sin imágenes aún</div>';

    el.innerHTML = `
      <div class="panel-head${isArchived ? ' panel-head-archived' : ''}" style="--node-color:${node.color}">
        <div class="panel-kicker">
          <span class="node-type-chip chip-${node.type}">${typeLabel(node.type)}</span>
          <span class="status-chip status-${node.status}">${isArchived ? '📦 Archivado' : '🟢 Activo'}</span>
          · <code class="mono">${node.id}</code>
        </div>
        <h2 class="panel-title"><span class="panel-icon">${esc(node.icon)}</span>${esc(node.name)}</h2>
        <div class="panel-breadcrumb">${renderBreadcrumb(lin.path)}</div>
      </div>

      <div class="panel-meta">
        <div class="meta-row"><span class="ml">Tipo</span><span class="mv">${typeLabel(node.type)}</span></div>
        <div class="meta-row"><span class="ml">Estado</span><span class="mv"><span class="status-chip status-${node.status}">${isArchived ? '📦 Archivado' : '🟢 Activo'}</span></span></div>
        <div class="meta-row"><span class="ml">Creado</span><span class="mv">${new Date(node.createdAt).toLocaleString()}</span></div>
        <div class="meta-row"><span class="ml">Actualizado</span><span class="mv">${new Date(node.updatedAt || node.createdAt).toLocaleString()}</span></div>
        <div class="meta-row"><span class="ml">Hijos directos</span><span class="mv">${childCount}</span></div>
        <div class="meta-row"><span class="ml">Descendientes</span><span class="mv">${descCount}</span></div>
        <div class="meta-row"><span class="ml">Color</span><span class="mv"><span class="sw" style="background:${node.color}"></span><code class="mono">${esc(node.color)}</code></span></div>
      </div>

      ${isArchived ? `<div class="archived-banner">📦 Este nodo está archivado. No aparece como seleccionable en otros módulos. Sus descendientes activos sí siguen disponibles.</div>` : ''}

      <div class="panel-actions">${actionBtns.join('')}</div>

      <div class="panel-section">
        <div class="ps-head">
          <span>📝 Notas <span class="ps-sub">(con semáforo)</span></span>
          <span class="ps-count">${node.notas.length}</span>
        </div>
        <div class="nota-add">
          <select id="pn-estado">
            <option value="normal">🟢 Normal</option>
            <option value="positivo">🔵 Positivo</option>
            <option value="atencion">🟡 Atención</option>
            <option value="peligro">🔴 Peligro</option>
          </select>
          <input type="text" id="pn-texto" placeholder="Nueva nota..." onkeydown="if(event.key==='Enter')ge.addNotaFromPanel()" />
          <button class="btn btn-primary btn-sm" onclick="ge.addNotaFromPanel()">+ Añadir</button>
        </div>
        <div class="nota-list">${notasHtml}</div>
      </div>

      <div class="panel-section">
        <div class="ps-head">
          <span>🖼️ Galería</span>
          <span class="ps-count">${node.imagenes.length}</span>
        </div>
        <div class="img-upload" onclick="document.getElementById('pn-img').click()">
          <span class="img-upload-ico">📷</span>
          <span>Click para subir imágenes (múltiples)</span>
          <input type="file" id="pn-img" accept="image/*" multiple style="display:none" onchange="ge.uploadImages(event)" />
        </div>
        <div class="img-grid">${imagenesHtml}</div>
      </div>`;
  }

  /**
   * Catálogo — tabla plana de nodos seleccionables.
   * Activos arriba, archivados abajo (colapsables).
   * Esta es la vista que CI puede tomar como referencia visual.
   * getSelectableGenetics() es la API programática — el catálogo es el equivalente visual.
   */
  function renderCatalog() {
    const body = document.getElementById('catalog-body');
    if (!body) return;

    // Todos los nodos que alguna vez fueron o son seleccionables
    // (phenotype + strain sin hijos), sin filtrar por status
    const allSelectable = state.nodes.filter((n) => {
      if (n.type === 'species')   return false;
      if (n.type === 'phenotype') return true;
      if (n.type === 'strain')    return getChildren(n.id).length === 0;
      return false;
    });

    const activos    = allSelectable.filter((n) => n.status === 'active');
    const archivados = allSelectable.filter((n) => n.status === 'archived');

    function buildRow(n) {
      const lin   = resolveLineage(n.id);
      const sp    = lin.speciesId ? getNode(lin.speciesId) : null;
      const st    = lin.strainId  ? getNode(lin.strainId)  : null;
      const parts = [];
      if (sp) parts.push(sp.name);
      if (st && st.id !== n.id) parts.push(st.name);
      parts.push(n.name);
      const label     = parts.join(' / ');
      const isArch    = n.status === 'archived';
      const btnLabel  = isArch ? '♻️ Restaurar' : '📦 Archivar';
      const btnClass  = isArch ? 'btn-restore' : 'btn-archive';
      return `
        <div class="cat-row${isArch ? ' cat-row-archived' : ''}">
          <span class="cat-type"><span class="node-type-chip chip-${n.type}">${typeLabel(n.type)}</span></span>
          <span class="cat-label">${esc(label)}</span>
          <span class="cat-species">${sp ? esc(sp.name) : '—'}</span>
          <span class="cat-updated">${new Date(n.updatedAt || n.createdAt).toLocaleDateString()}</span>
          <span class="cat-actions">
            <button class="btn ${btnClass} btn-sm btn-xs" onclick="ge.toggleNodeStatus('${n.id}')">${btnLabel}</button>
            <button class="btn btn-ghost btn-sm btn-xs" onclick="ge.selectNode('${n.id}');ge.setView('tree')" title="Ver en árbol">🌳</button>
          </span>
        </div>`;
    }

    const activosHtml = activos.length
      ? activos.sort((a, b) => a.name.localeCompare(b.name, 'es')).map(buildRow).join('')
      : '<div class="empty-mini pad">Sin genéticos activos aún.</div>';

    const archivadosHtml = archivados.length
      ? archivados.sort((a, b) => a.name.localeCompare(b.name, 'es')).map(buildRow).join('')
      : '<div class="empty-mini pad">Sin archivados.</div>';

    body.innerHTML = `
      <div class="cat-section">
        <div class="cat-section-head">
          <span>🟢 Activos <span class="ps-count">${activos.length}</span></span>
          <span class="cat-sub">Disponibles para CI y otros módulos</span>
        </div>
        <div class="cat-head-row">
          <span>Tipo</span><span>Linaje</span><span>Especie</span><span>Actualizado</span><span>Acción</span>
        </div>
        ${activosHtml}
      </div>

      <details class="cat-section cat-archived-section" ${archivados.length ? '' : 'open'}>
        <summary class="cat-section-head cat-section-toggle">
          <span>📦 Archivados <span class="ps-count">${archivados.length}</span></span>
          <span class="cat-sub">No disponibles para módulos externos</span>
        </summary>
        <div class="cat-head-row">
          <span>Tipo</span><span>Linaje</span><span>Especie</span><span>Archivado</span><span>Acción</span>
        </div>
        ${archivadosHtml}
      </details>`;
  }

  function renderHistory() {
    const body = document.getElementById('hist-body');
    if (!body) return;
    if (!state.records.length) {
      body.innerHTML = '<div class="empty-mini pad">Sin eventos aún.</div>';
      return;
    }
    const rows = state.records.slice(0, HISTORY_CAP).map((r) => `
      <div class="hist-row action-${r.action}">
        <span class="hist-when">${new Date(r.timestamp).toLocaleString()}</span>
        <span class="hist-action"><span class="act-pill act-${r.action}">${r.action}</span></span>
        <span class="hist-type">${typeLabel(r.nodeType)}</span>
        <span class="hist-name">${esc(r.nodeName)}</span>
        <span class="hist-id"><code class="mono">${r.nodeId}</code></span>
      </div>`).join('');
    const overflow = state.records.length > HISTORY_CAP
      ? `<div class="empty-mini pad">Mostrando los ${HISTORY_CAP} más recientes de ${state.records.length}</div>`
      : '';
    body.innerHTML = `
      <div class="hist-head-row">
        <span>Timestamp</span><span>Acción</span><span>Tipo</span><span>Nombre</span><span>Node ID</span>
      </div>${rows}${overflow}`;
  }

  function renderApiPreview() {
    const out    = document.getElementById('api-output');
    const jsonEl = document.getElementById('api-json');
    const sel    = getSelectableGenetics();
    if (jsonEl) jsonEl.textContent = JSON.stringify(sel.slice(0, 50), null, 2);
    if (!out) return;
    if (!sel.length) {
      out.innerHTML = '<div class="empty-mini pad">No hay genéticos activos seleccionables.</div>';
      return;
    }
    out.innerHTML = `
      <div class="sel-head-row">
        <span>ID</span><span>Label (lineage)</span><span>speciesId</span><span>strainId</span>
      </div>
      ${sel.map((s) => `
        <div class="sel-row">
          <code class="mono">${s.id}</code>
          <span class="sel-label">${esc(s.label)}</span>
          <code class="mono dim">${s.speciesId || '—'}</code>
          <code class="mono dim">${s.strainId  || '—'}</code>
        </div>`).join('')}`;
  }

  /**
   * Render completo: sincroniza tabs + vista activa.
   * Llamar cuando cambia la vista o la estructura del árbol.
   */
  function renderAll() {
    renderStats();
    document.querySelectorAll('[data-view]').forEach((v) => {
      v.classList.toggle('hidden', v.dataset.view !== state.ui.view);
    });
    document.querySelectorAll('[data-view-tab]').forEach((t) => {
      t.classList.toggle('active', t.dataset.viewTab === state.ui.view);
    });
    if (state.ui.view === 'tree') {
      renderTree();
      renderPanel();
    } else if (state.ui.view === 'graph') {
      renderGraph();
    } else if (state.ui.view === 'catalog') {
      renderCatalog();
    } else if (state.ui.view === 'history') {
      renderHistory();
    } else if (state.ui.view === 'api') {
      renderApiPreview();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. MODAL (create / edit)
  // ═══════════════════════════════════════════════════════════════════════════

  function openModal(cfg) {
    const isEdit = cfg.mode === 'edit';
    const node   = isEdit ? getNode(cfg.nodeId) : null;
    if (isEdit && !node) return;
    const type   = isEdit ? node.type : cfg.type;
    const parent = !isEdit && cfg.parentId ? getNode(cfg.parentId) : null;

    let crumbPath = [];
    if (isEdit)      crumbPath = resolveLineage(node.id).path.slice(0, -1);
    else if (parent) crumbPath = resolveLineage(parent.id).path;

    const host = document.getElementById('modal-host');
    if (!host) return;

    host.innerHTML = `
      <div class="modal-overlay" onclick="ge.modalBgClick(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-head">
            <div>
              <div class="modal-kicker">${isEdit ? 'Editar' : 'Crear'} · <span class="node-type-chip chip-${type}">${typeLabel(type)}</span></div>
              <div class="modal-crumb">${renderBreadcrumb(crumbPath)}${isEdit ? '' : '<span class="bc-sep">›</span><span class="bc-seg bc-new">nuevo</span>'}</div>
            </div>
            <button class="icon-btn" onclick="ge.closeModal()">✕</button>
          </div>
          <div class="modal-body">
            <div class="fg">
              <label>Nombre *</label>
              <input type="text" id="mf-name" value="${isEdit ? esc(node.name) : ''}" placeholder="${placeholderFor(type)}" onkeydown="if(event.key==='Enter')ge.modalSave()" />
            </div>
            <div class="fg">
              <label>Descripción breve <span style="color:var(--tx3);font-weight:400;text-transform:none">(aparece en el árbol como ↳)</span></label>
              <textarea id="mf-desc" rows="3" placeholder="ej: derivación directa por recomposición epigenética&#10;registro: 9.000 esporas" style="resize:vertical">${isEdit ? esc(node.descripcion || '') : ''}</textarea>
            </div>
            <div class="fr2">
              <div class="fg">
                <label>Icono (emoji)</label>
                <input type="text" id="mf-icon" maxlength="4" value="${isEdit ? esc(node.icon) : defaultIcon(type)}" />
              </div>
              <div class="fg">
                <label>Color identificador</label>
                <div class="color-row">
                  <input type="color" id="mf-color" value="${isEdit ? node.color : defaultColor(type)}"
                         oninput="document.getElementById('mf-color-hex').value=this.value" />
                  <input type="text"  id="mf-color-hex" value="${isEdit ? node.color : defaultColor(type)}"
                         oninput="const v=this.value;if(/^#[0-9a-fA-F]{6}$/.test(v))document.getElementById('mf-color').value=v" />
                </div>
              </div>
            </div>
            ${isEdit ? '' : `
              <div class="modal-hint">
                📍 Se creará como hijo directo de
                <b>${parent ? esc(parent.name) : 'raíz (nueva especie)'}</b>${parent ? ` (${typeLabel(parent.type)})` : ''}.
              </div>`}
          </div>
          <div class="modal-foot">
            <button class="btn btn-secondary" onclick="ge.closeModal()">Cancelar</button>
            <button class="btn btn-primary"   onclick="ge.modalSave()">💾 ${isEdit ? 'Guardar cambios' : 'Crear'}</button>
          </div>
        </div>
      </div>`;

    state.ui.modal = { mode: cfg.mode, type, parentId: cfg.parentId || null, nodeId: cfg.nodeId || null };
    setTimeout(() => { const el = document.getElementById('mf-name'); if (el) { el.focus(); el.select(); } }, 0);
  }

  function closeModal() {
    const host = document.getElementById('modal-host');
    if (host) host.innerHTML = '';
    state.ui.modal = null;
  }

  function modalSave() {
    const m = state.ui.modal;
    if (!m) return;
    const name        = (document.getElementById('mf-name')?.value || '').trim();
    const icon        = (document.getElementById('mf-icon')?.value || '').trim() || defaultIcon(m.type);
    const color       =  document.getElementById('mf-color')?.value || defaultColor(m.type);
    const descripcion =  document.getElementById('mf-desc')?.value  || '';
    if (!name) { toast('El nombre es obligatorio', 'err'); return; }
    try {
      if (m.mode === 'create') {
        const n = createNode({ type: m.type, parentId: m.parentId, name, icon, color, descripcion });
        state.ui.selectedId = n.id;
        if (m.parentId) state.ui.collapsed.delete(m.parentId);
        closeModal();
        renderAll();
        toast(`${typeLabel(m.type)} creada`, 'ok');
      } else {
        updateNode(m.nodeId, { name, icon, color, descripcion });
        closeModal();
        renderStats();
        renderTree();
        renderPanel();
        toast('Actualizado', 'ok');
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. INLINE EDIT (doble click en el label del árbol)
  // ═══════════════════════════════════════════════════════════════════════════

  function inlineEditStart(e, nodeId) {
    e.stopPropagation();
    const node = getNode(nodeId);
    if (!node) return;
    const labelEl = e.currentTarget;
    if (!labelEl) return;

    const input = document.createElement('input');
    input.type      = 'text';
    input.value     = node.name;
    input.className = 'ge-inline-input';
    input.style.width = Math.max(labelEl.offsetWidth, 120) + 'px';
    labelEl.parentNode.replaceChild(input, labelEl);
    input.focus();
    input.select();

    let committed = false;
    function commit() {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      if (newName && newName !== node.name) {
        updateNode(nodeId, { name: newName });
        toast('Nombre actualizado', 'ok');
      }
      renderTree();
      renderPanel();
    }

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter')  { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { committed = true; renderTree(); }
    });
    input.addEventListener('blur', commit);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. TOAST
  // ═══════════════════════════════════════════════════════════════════════════

  let _toastTimer = null;
  function toast(msg, kind = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.className   = `toast show kind-${kind}`;
    el.textContent = msg;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => (el.className = 'toast'), 2600);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 17. LIGHTBOX
  // ═══════════════════════════════════════════════════════════════════════════

  function openLightbox(nodeId, i) {
    const n = getNode(nodeId);
    if (!n || !n.imagenes[i]) return;
    state.ui.lightbox = { nodeId, index: i };
    renderLightbox();
  }

  function renderLightbox() {
    const lb   = state.ui.lightbox;
    const host = document.getElementById('lightbox-host');
    if (!host) return;
    if (!lb) { host.innerHTML = ''; return; }
    const n  = getNode(lb.nodeId);
    if (!n)  { host.innerHTML = ''; return; }
    const im = n.imagenes[lb.index];
    if (!im) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="lb-overlay" onclick="ge.lbBgClick(event)">
        <button class="lb-close" onclick="ge.lbClose()" title="Cerrar (Esc)">✕</button>
        <button class="lb-prev"  onclick="ge.lbNav(-1)" ${n.imagenes.length < 2 ? 'disabled' : ''}>‹</button>
        <button class="lb-next"  onclick="ge.lbNav(1)"  ${n.imagenes.length < 2 ? 'disabled' : ''}>›</button>
        <img class="lb-img" src="${im.dataUrl}" alt="${esc(im.name)}" onclick="event.stopPropagation()" />
        <div class="lb-info">${esc(n.name)} · ${esc(im.name)} · ${lb.index + 1} / ${n.imagenes.length}</div>
      </div>`;
  }

  function lbNav(dir) {
    if (!state.ui.lightbox) return;
    const n = getNode(state.ui.lightbox.nodeId);
    if (!n) return;
    state.ui.lightbox.index = (state.ui.lightbox.index + dir + n.imagenes.length) % n.imagenes.length;
    renderLightbox();
  }

  function lbClose() {
    state.ui.lightbox = null;
    renderLightbox();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 18. IMPORT / EXPORT / RESET
  // ═══════════════════════════════════════════════════════════════════════════

  function exportJSON() {
    const blob = new Blob([JSON.stringify({
      version: 4, schema: 'biolab.ge.tree', exportedAt: nowIso(),
      nodes: state.nodes, records: state.records
    }, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `biolab-ge-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Exportado', 'ok');
  }

  function importJSON(evt) {
    const f = evt.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!parsed || !Array.isArray(parsed.nodes))
          throw new Error('JSON inválido: falta nodes[]');
        if (!confirm(
          `Esto REEMPLAZARÁ los datos actuales (${state.nodes.length} nodos) ` +
          `por ${parsed.nodes.length} nodos. ¿Continuar?`
        )) return;
        state.nodes         = parsed.nodes;
        state.records       = Array.isArray(parsed.records) ? parsed.records : [];
        state.ui.selectedId = null;
        state.ui.collapsed  = new Set();
        // Migración defensiva al importar
        for (const n of state.nodes) {
          if (!NODE_STATUSES.includes(n.status)) n.status = 'active';
        }
        rebuildAllIndexes();
        save();
        renderAll();
        toast('Importado correctamente', 'ok');
      } catch (e) {
        console.error('[GE] importJSON:', e);
        toast('JSON inválido', 'err');
      }
    };
    r.readAsText(f);
    evt.target.value = '';
  }

  function resetAll() {
    if (!confirm('¿Borrar TODO el árbol genético y su historial?')) return;
    if (!confirm('Confirmación final: esta acción NO se puede deshacer.')) return;
    state.nodes = []; state.records = [];
    state.ui.selectedId = null; state.ui.collapsed = new Set();
    rebuildAllIndexes();
    save();
    renderAll();
    toast('Datos borrados', 'ok');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 19. ESTILOS (inyección única, idempotente)
  // ═══════════════════════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById('ge-styles')) return;
    const style = document.createElement('style');
    style.id = 'ge-styles';
    style.textContent = `
      /* ── Árbol ASCII ─────────────────────────────────────────────────────── */
      .ge-ascii-tree {
        font-family: 'JetBrains Mono', 'Fira Mono', 'Consolas', monospace;
        font-size: 13px; line-height: 1.8;
        background: #080c10; border: 1px solid rgba(0,229,160,.12);
        border-radius: 8px;
        margin: 6px; padding: 14px 10px;
        white-space: pre; overflow-x: auto;
        color: #c8d4e0;
        box-shadow: inset 0 0 40px rgba(0,0,0,.4);
      }
      .ge-line {
        display: block; cursor: pointer;
        border-radius: 4px; padding: 2px 6px 2px 2px;
        transition: background .12s; white-space: pre;
      }
      .ge-line:hover  { background: rgba(255,255,255,.06); }
      .ge-line.ge-sel { background: rgba(0,229,160,.13); border-left: 2px solid #00e5a0; padding-left: 4px; }
      .ge-line.ge-sel .ge-label { font-weight: 700; }
      .ge-line.ge-dim { opacity: .32; }
      .ge-line.ge-sep { cursor: default; pointer-events: none; }
      .ge-prefix { color: #3a4458; user-select: none; pointer-events: none; }
      .ge-label  { font-weight: 500; }
      .ge-type-species   { color: #56e87a; font-weight: 700; letter-spacing: .4px; text-shadow: 0 0 12px rgba(86,232,122,.35); }
      .ge-type-strain    { color: #b8a8ff; text-shadow: 0 0 12px rgba(184,168,255,.25); }
      .ge-type-phenotype { color: #55bbff; text-shadow: 0 0 12px rgba(85,187,255,.2); }

      /* Nodo archivado en el árbol: label atenuado + tachado suave */
      .ge-label.ge-archived { opacity: .45; text-decoration: line-through; text-decoration-color: rgba(255,255,255,.3); }

      /* Badge arch en el árbol */
      .badge-arch {
        display: inline-block; font-size: 9px; font-weight: 600;
        background: rgba(255,180,0,.15); color: #c8960a;
        border: 1px solid rgba(200,150,10,.35);
        border-radius: 3px; padding: 0 4px; margin-left: 4px;
        vertical-align: middle; letter-spacing: .5px;
        font-family: 'JetBrains Mono', monospace;
      }

      .ge-inline-actions {
        display: inline-flex; align-items: center; gap: 4px;
        margin-left: 8px; opacity: 0; transition: opacity .15s; vertical-align: middle;
      }
      .ge-line:hover .ge-inline-actions { opacity: 1; }
      .ascii-caret {
        font-size: 11px; color: var(--tx3, #555570);
        cursor: pointer; padding: 0 3px; border-radius: 3px; user-select: none;
      }
      .ascii-caret:hover { color: var(--tx, #c8c8d8); background: rgba(255,255,255,.08); }

      .ge-inline-input {
        font-family: inherit; font-size: inherit;
        background: var(--bg2, #1e1e2e); color: var(--tx, #c8c8d8);
        border: 1px solid var(--ac, #00e5a0); border-radius: 3px;
        padding: 0 4px; outline: none;
      }

      /* ── Status chips ────────────────────────────────────────────────────── */
      .status-chip {
        display: inline-flex; align-items: center; gap: 4px;
        font-size: 11px; font-weight: 600; border-radius: 10px;
        padding: 1px 8px;
      }
      .status-chip.status-active   { background: rgba(80,200,100,.15); color: #50c864; border: 1px solid rgba(80,200,100,.3); }
      .status-chip.status-archived { background: rgba(200,150,10,.12); color: #c8960a; border: 1px solid rgba(200,150,10,.3); }

      /* ── Panel archivado ─────────────────────────────────────────────────── */
      .panel-head-archived { opacity: .75; }
      .archived-banner {
        margin: 0 0 12px 0; padding: 10px 14px;
        background: rgba(200,150,10,.1); border: 1px solid rgba(200,150,10,.25);
        border-radius: 6px; font-size: 12px; color: #c8960a; line-height: 1.5;
      }

      /* Botones de status */
      .btn-archive { background: rgba(200,150,10,.15); color: #c8960a; border: 1px solid rgba(200,150,10,.35); }
      .btn-archive:hover { background: rgba(200,150,10,.28); }
      .btn-restore { background: rgba(80,200,100,.15); color: #50c864; border: 1px solid rgba(80,200,100,.3); }
      .btn-restore:hover { background: rgba(80,200,100,.28); }
      .btn-ghost   { background: transparent; color: var(--tx2, #8888a8); border: 1px solid rgba(255,255,255,.1); }
      .btn-ghost:hover { background: rgba(255,255,255,.06); }
      .btn-xs { font-size: 11px; padding: 2px 8px; }

      /* ── Breadcrumb archivado ────────────────────────────────────────────── */
      .bc-seg.bc-archived { opacity: .55; }
      .bc-arch-tag {
        font-size: 9px; font-weight: 600; color: #c8960a;
        background: rgba(200,150,10,.15); border-radius: 3px;
        padding: 0 3px; margin-left: 3px; vertical-align: middle;
      }

      /* ── Catálogo ────────────────────────────────────────────────────────── */
      .cat-section { margin-bottom: 24px; }
      .cat-section-head {
        display: flex; align-items: center; gap: 10px; justify-content: space-between;
        padding: 10px 14px; background: var(--bg2, #1a1a2a);
        border-radius: 6px 6px 0 0; border-bottom: 1px solid var(--border, #2a2a3a);
        font-size: 13px; font-weight: 600;
      }
      .cat-section-toggle { cursor: pointer; user-select: none; list-style: none; }
      .cat-section-toggle::-webkit-details-marker { display: none; }
      .cat-sub { font-size: 11px; font-weight: 400; color: var(--tx3, #555570); }
      .cat-head-row, .cat-row {
        display: grid;
        grid-template-columns: 100px 1fr 140px 100px 160px;
        gap: 8px; align-items: center;
        padding: 7px 14px; font-size: 12px;
        border-bottom: 1px solid rgba(255,255,255,.04);
      }
      .cat-head-row {
        font-size: 11px; font-weight: 600; color: var(--tx3, #555570);
        text-transform: uppercase; letter-spacing: .5px;
        background: var(--bg2, #1a1a2a);
      }
      .cat-row:hover { background: rgba(255,255,255,.03); }
      .cat-row-archived { opacity: .6; }
      .cat-row-archived .cat-label { text-decoration: line-through; text-decoration-color: rgba(255,255,255,.25); }
      .cat-actions { display: flex; gap: 6px; }
      .cat-archived-section { border: 1px solid rgba(255,255,255,.07); border-radius: 6px; margin-top: 12px; }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 20. LISTENER DE TECLADO
  // ═══════════════════════════════════════════════════════════════════════════

  let _keydownHandler = null;

  function attachKeydownHandler() {
    if (_keydownHandler) document.removeEventListener('keydown', _keydownHandler);
    _keydownHandler = (e) => {
      if (e.key !== 'Escape') return;
      if (state.ui.lightbox) { lbClose();    return; }
      if (state.ui.modal)    { closeModal(); return; }
    };
    document.addEventListener('keydown', _keydownHandler);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 21. INIT
  // ═══════════════════════════════════════════════════════════════════════════

  function init() {
    load();
    rebuildAllIndexes();
    injectStyles();
    injectGraphStyles();
    attachKeydownHandler();
    renderAll();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 21b. GRAFO VISUAL (SVG jerárquico)
  // ═══════════════════════════════════════════════════════════════════════════

  function injectGraphStyles() {
    if (document.getElementById('ge-graph-styles')) return;
    const s = document.createElement('style');
    s.id = 'ge-graph-styles';
    s.textContent = `
      .ge-graph-toolbar {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.06);
        background: rgba(0,0,0,.25);
      }
      .ge-graph-hint {
        font-size: 12px; color: #6878a0; font-family: 'JetBrains Mono', monospace;
        display: flex; align-items: center; gap: 8px;
      }
      .ge-graph-back {
        font-size: 11px; padding: 2px 10px; margin-left: 4px;
      }
      .ge-graph-container {
        overflow: auto; padding: 24px 16px; min-height: 400px;
        background: #080c10;
      }
      .ge-graph-svg {
        display: block; min-width: 100%;
      }
      .ge-gnode rect { transition: filter .15s; }
      .ge-gnode:hover rect { filter: brightness(1.25); }
      .ge-graph-empty {
        color: #4a5570; font-size: 14px;
        font-family: 'JetBrains Mono', monospace;
        padding: 48px; text-align: center;
      }
      .ge-graph-legend {
        display: flex; gap: 18px; padding: 10px 18px;
        background: rgba(255,255,255,.03); border-top: 1px solid rgba(255,255,255,.05);
        font-size: 11px; font-family: 'JetBrains Mono', monospace; color: #6878a0;
      }
      .ge-graph-legend-dot {
        display: inline-block; width: 10px; height: 10px;
        border-radius: 3px; margin-right: 5px; vertical-align: middle;
      }
    `;
    document.head.appendChild(s);
  }

  function renderGraph() {
    const wrap = document.getElementById('ge-graph-wrap');
    if (!wrap) return;

    const roots = getRoots();
    if (!roots.length) {
      wrap.innerHTML = '<div class="ge-graph-empty">No hay nodos en el árbol genético.<br>Creá una especie para comenzar.</div>';
      return;
    }

    // ── Layout constants ────────────────────────────────────────────
    const NODE_W  = 168;
    const NODE_H  = 50;
    const LEVEL_H = 120;
    const X_GAP   = 28;
    const Y_START = 40;

    // ── Leaf count (for centering subtrees) ─────────────────────────
    function countLeaves(id) {
      const ch = getChildren(id);
      if (!ch.length) return 1;
      return ch.reduce(function(sum, c) { return sum + countLeaves(c.id); }, 0);
    }

    // ── Assign positions recursively ────────────────────────────────
    var positions = {};  // id → { x, y, cx, cy }

    function assignPos(nodeId, xOffset, depth) {
      var ch     = getChildren(nodeId);
      var leaves = countLeaves(nodeId);
      var totalW = leaves * (NODE_W + X_GAP) - X_GAP;
      var x      = xOffset + (totalW - NODE_W) / 2;
      var y      = Y_START + depth * LEVEL_H;
      positions[nodeId] = { x: x, y: y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 };
      var childX = xOffset;
      ch.forEach(function(c) {
        var cLeaves = countLeaves(c.id);
        assignPos(c.id, childX, depth + 1);
        childX += cLeaves * (NODE_W + X_GAP);
      });
    }

    var cursorX = X_GAP;
    roots.forEach(function(r) {
      var leaves = countLeaves(r.id);
      assignPos(r.id, cursorX, 0);
      cursorX += leaves * (NODE_W + X_GAP) + X_GAP;
    });

    // ── SVG dimensions ──────────────────────────────────────────────
    var allPos = Object.values(positions);
    var svgW   = allPos.length ? Math.max.apply(null, allPos.map(function(p) { return p.x + NODE_W; })) + X_GAP * 2 : 400;
    var maxY   = allPos.length ? Math.max.apply(null, allPos.map(function(p) { return p.y; })) : 0;
    var svgH   = maxY + NODE_H + 60;

    // ── Type visuals ────────────────────────────────────────────────
    var TYPE_V = {
      species:   { fill: 'rgba(86,232,122,.15)',  stroke: '#56e87a', text: '#7dffa0', label: '#56e87a' },
      strain:    { fill: 'rgba(184,168,255,.14)', stroke: '#b8a8ff', text: '#cfc0ff', label: '#b8a8ff' },
      phenotype: { fill: 'rgba(85,187,255,.14)',  stroke: '#55bbff', text: '#88d5ff', label: '#55bbff' }
    };

    // ── Build edges ─────────────────────────────────────────────────
    var edges = '';
    state.nodes.forEach(function(n) {
      if (!n.parentId) return;
      var p = positions[n.parentId];
      var c = positions[n.id];
      if (!p || !c) return;
      var x1 = p.cx, y1 = p.y + NODE_H;
      var x2 = c.cx, y2 = c.y;
      var dy = (y2 - y1) * 0.55;
      edges += '<path d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + (y1 + dy) +
               ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2 +
               '" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="1.5"/>';
    });

    // ── Build nodes ─────────────────────────────────────────────────
    var nodesHtml = '';
    Object.keys(positions).forEach(function(id) {
      var node = getNode(id);
      if (!node) return;
      var pos      = positions[id];
      var v        = TYPE_V[node.type] || TYPE_V.phenotype;
      var isSel    = (id === state.ui.selectedId);
      var isArch   = (node.status === 'archived');
      var opacity  = isArch ? 0.42 : 1;
      var sw       = isSel ? 2 : 1;
      var sc       = isSel ? '#00e5a0' : v.stroke;
      var fill     = isSel ? v.fill.replace('.15', '.32').replace('.14', '.30') : v.fill;

      var maxChars = 17;
      var dispName = node.name.length > maxChars ? node.name.slice(0, maxChars) + '…' : node.name;
      var icon     = node.icon ? esc(node.icon) + ' ' : '';
      var archTag  = isArch ? ' 📦' : '';

      // Children count badge
      var ch = getChildren(id);
      var badge = ch.length > 0
        ? '<rect x="' + (NODE_W - 22) + '" y="-8" width="22" height="16" rx="8" fill="rgba(0,0,0,.6)" stroke="' + v.stroke + '" stroke-width="1"/>' +
          '<text x="' + (NODE_W - 11) + '" y="5" text-anchor="middle" font-size="9" fill="' + v.label + '" font-family="JetBrains Mono,monospace" font-weight="600">' + ch.length + '</text>'
        : '';

      // Sel ring
      var selRing = isSel
        ? '<rect x="-3" y="-3" width="' + (NODE_W + 6) + '" height="' + (NODE_H + 6) + '" rx="10" fill="none" stroke="rgba(0,229,160,.5)" stroke-width="1" stroke-dasharray="4,3"/>'
        : '';

      nodesHtml += '<g class="ge-gnode" data-id="' + id + '" onclick="ge.selectNodeFromGraph(\'' + id + '\')" ' +
        'style="cursor:pointer;opacity:' + opacity + '" transform="translate(' + pos.x + ',' + pos.y + ')">' +
        selRing +
        '<rect width="' + NODE_W + '" height="' + NODE_H + '" rx="8" fill="' + fill + '" stroke="' + sc + '" stroke-width="' + sw + '"/>' +
        badge +
        '<text x="' + (NODE_W / 2) + '" y="17" text-anchor="middle" font-size="9" fill="' + v.label + '" ' +
          'font-family="JetBrains Mono,monospace" font-weight="700" letter-spacing="1.2">' +
          node.type.toUpperCase() + archTag +
        '</text>' +
        '<text x="' + (NODE_W / 2) + '" y="36" text-anchor="middle" font-size="12.5" fill="' + v.text + '" ' +
          'font-family="JetBrains Mono,monospace" font-weight="600">' +
          icon + esc(dispName) +
        '</text>' +
        '</g>';
    });

    // ── Legend ──────────────────────────────────────────────────────
    var totalNodes = allPos.length;
    var totalEdges = state.nodes.filter(function(n) { return n.parentId; }).length;

    wrap.innerHTML =
      '<div class="ge-graph-legend">' +
        '<span><span class="ge-graph-legend-dot" style="background:rgba(86,232,122,.4);border:1px solid #56e87a"></span>Especie</span>' +
        '<span><span class="ge-graph-legend-dot" style="background:rgba(184,168,255,.4);border:1px solid #b8a8ff"></span>Cepa</span>' +
        '<span><span class="ge-graph-legend-dot" style="background:rgba(85,187,255,.4);border:1px solid #55bbff"></span>Fenotipo</span>' +
        '<span style="margin-left:auto">' + totalNodes + ' nodos · ' + totalEdges + ' relaciones</span>' +
      '</div>' +
      '<svg class="ge-graph-svg" width="' + svgW + '" height="' + svgH + '" ' +
           'viewBox="0 0 ' + svgW + ' ' + svgH + '" xmlns="http://www.w3.org/2000/svg">' +
        '<g class="ge-graph-edges">' + edges + '</g>' +
        '<g class="ge-graph-nodes">' + nodesHtml + '</g>' +
      '</svg>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 22. API PÚBLICA — window.ge
  // ═══════════════════════════════════════════════════════════════════════════

  const ge = {
    // ── Data API (consumida por CI y otros módulos) ────────────────────────
    getSelectableGenetics,
    getNode,
    getNodes:        () => state.nodes.slice(),
    getChildren,
    getRoots,
    getAncestors,
    getDescendantIds,
    resolveLineage,
    getRecords:      () => state.records.slice(),

    // ── Init ───────────────────────────────────────────────────────────────
    init,
    inlineEditStart,

    // ── Vistas ─────────────────────────────────────────────────────────────
    setView(v) {
      state.ui.view = v;
      renderAll();
    },

    // ── Selección y colapso — UI pura, sin save() ──────────────────────────
    selectNode(id) {
      state.ui.selectedId = id;
      renderTree();
      renderPanel();
    },

    selectNodeFromGraph(id) {
      state.ui.selectedId = id;
      ge.setView('tree');
    },

    toggleCollapse(e, id) {
      e.stopPropagation();
      if (state.ui.collapsed.has(id)) state.ui.collapsed.delete(id);
      else state.ui.collapsed.add(id);
      renderTree();
    },

    expandAll() {
      state.ui.collapsed.clear();
      renderTree();
    },

    collapseAll() {
      state.ui.collapsed = new Set(
        state.nodes.filter((n) => getChildren(n.id).length > 0).map((n) => n.id)
      );
      renderTree();
    },

    setSearch(v) {
      state.ui.search = v;
      renderTree();
    },

    // ── Status (archivar / restaurar) ──────────────────────────────────────
    /**
     * Toggle de status del nodo seleccionado (o de un id explícito).
     * Llamado desde el panel y desde el catálogo.
     */
    toggleNodeStatus(id) {
      const n = getNode(id);
      if (!n) return;
      const newStatus = n.status === 'active' ? 'archived' : 'active';
      const verb      = newStatus === 'archived' ? 'archivar' : 'restaurar';
      if (!confirm(`¿${verb.charAt(0).toUpperCase() + verb.slice(1)} "${n.name}"?`)) return;
      setNodeStatus(id, newStatus);
      // Status no cambia estructura ni labels del árbol — solo badge y panel
      renderStats();
      renderTree();
      renderPanel();
      // Si el catálogo está abierto, actualizarlo también
      if (state.ui.view === 'catalog') renderCatalog();
      toast(newStatus === 'archived' ? 'Archivado' : 'Restaurado', 'ok');
    },

    // ── Modal ──────────────────────────────────────────────────────────────
    openCreate(type, parentId) { openModal({ mode: 'create', type, parentId }); },
    openEdit(nodeId)           { openModal({ mode: 'edit', nodeId }); },
    closeModal,
    modalSave,
    modalBgClick(e) { if (e.target.classList.contains('modal-overlay')) closeModal(); },

    // ── Notas ──────────────────────────────────────────────────────────────
    addNotaFromPanel() {
      const id = state.ui.selectedId;
      if (!id) return;
      const texto  = (document.getElementById('pn-texto')?.value || '').trim();
      const estado =  document.getElementById('pn-estado')?.value || 'normal';
      if (!texto) { toast('Escribe el texto de la nota', 'err'); return; }
      addNota(id, { texto, estado });
      renderStats();
      renderTree();
      renderPanel();
    },

    removeNotaFromPanel(notaId) {
      const id = state.ui.selectedId;
      if (!id) return;
      if (!confirm('¿Eliminar esta nota?')) return;
      removeNota(id, notaId);
      renderStats();
      renderTree();
      renderPanel();
    },

    // ── Imágenes ───────────────────────────────────────────────────────────
    uploadImages(evt) {
      const id = state.ui.selectedId;
      if (!id) return;
      const files = Array.from(evt.target.files || []);
      if (!files.length) return;
      let done = 0;
      files.forEach((f) => {
        const reader = new FileReader();
        reader.onload = () => {
          addImage(id, { dataUrl: reader.result, name: f.name });
          done++;
          if (done === files.length) { renderStats(); renderTree(); renderPanel(); }
        };
        reader.onerror = () => {
          done++;
          if (done === files.length) { renderStats(); renderTree(); renderPanel(); }
        };
        reader.readAsDataURL(f);
      });
      evt.target.value = '';
    },

    removeImageFromPanel(imgId) {
      const id = state.ui.selectedId;
      if (!id) return;
      if (!confirm('¿Eliminar esta imagen?')) return;
      removeImage(id, imgId);
      renderStats();
      renderTree();
      renderPanel();
    },

    // ── Eliminar nodo ──────────────────────────────────────────────────────
    deleteCurrent() {
      const id = state.ui.selectedId;
      if (!id) return;
      const n = getNode(id);
      if (!n) return;
      const descCount = idx.descendants.get(id)?.size ?? 0;
      const msg = descCount
        ? `¿Eliminar "${n.name}" y sus ${descCount} descendiente(s)? Esta acción queda registrada en el historial.`
        : `¿Eliminar "${n.name}"? Esta acción queda registrada en el historial.`;
      if (!confirm(msg)) return;
      deleteNode(id);
      renderAll();
      toast('Nodo eliminado', 'ok');
    },

    // ── Lightbox ───────────────────────────────────────────────────────────
    openLightbox,
    lbNav,
    lbClose,
    lbBgClick(e) { if (e.target.classList.contains('lb-overlay')) lbClose(); },

    // ── Config ─────────────────────────────────────────────────────────────
    exportJSON,
    importJSON,
    resetAll,

    // ── Debug ──────────────────────────────────────────────────────────────
    _state: state,
    _idx:   idx
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 23. CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  global.onModuleUnload = function () {
    if (_keydownHandler) {
      document.removeEventListener('keydown', _keydownHandler);
      _keydownHandler = null;
    }
    if (_toastTimer) {
      clearTimeout(_toastTimer);
      _toastTimer = null;
    }
  };

  global.ge     = ge;
  global.GEInit = ge.init;

  // Auto-inicialización si el módulo se carga solo (fuera del loader main.js)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { ge.init(); });
  } else {
    ge.init();
  }

})(window);
