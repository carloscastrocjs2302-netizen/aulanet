// =====================================================================
// AULANET · VISTA: CARGA DE EXCEL DE OBSERVACIONES
// =====================================================================
// Requiere SheetJS (XLSX) cargado por CDN en index.html
// =====================================================================

const VistaCargaExcel = {
  perfil: null,
  areaId: null,
  contenedor: null,
  cacheCursos: new Map(),      // nombre_normalizado -> {id, nombre}
  cacheAsignaturas: new Map(), // nombre_normalizado -> {id, nombre}
  cacheReglas: new Map(),      // nombre_excel|curso_excel -> estudiante_id
  estudiantesPorCurso: new Map(), // curso_id -> [{id, nombre_completo, nombre_normalizado}]
  periodoId: null,
  filasResueltas: [],          // {estudiante_id, asignatura_id, texto}
  alertas: [],                 // {tipo, nombreExcel, cursoExcel, asignaturaId, texto, opciones, resuelta, estudianteId}

  async render(contenedor, perfil, areaId) {
    this.perfil = perfil;
    this.areaId = areaId;
    this.contenedor = contenedor;
    this.filasResueltas = [];
    this.alertas = [];

    contenedor.innerHTML = `
      <div class="app-shell">
        <header class="barra-superior">
          <p class="logo-texto-chico"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
          <div class="acciones-barra">
            <button id="btnVolver" class="btn-icono" aria-label="Volver"><i class="ti ti-arrow-left" aria-hidden="true"></i></button>
          </div>
        </header>
        <main class="contenido-principal">
          <p class="titulo-seccion">Cargar observaciones</p>
          <p class="subtitulo-seccion" id="subtituloCarga">Selecciona el archivo Excel del área</p>

          <div id="zonaCarga" class="zona-drop">
            <i class="ti ti-file-spreadsheet" aria-hidden="true" style="font-size:26px;color:var(--texto-muted);"></i>
            <p style="margin:8px 0 4px;font-weight:600;font-size:13px;">Elige el archivo Excel</p>
            <p class="texto-muted">Una hoja por asignatura</p>
            <input type="file" id="inputExcel" accept=".xlsx,.xls" style="margin-top:12px;" />
          </div>

          <p id="mensajeProceso" class="texto-muted" style="margin-top:12px;"></p>

          <div id="zonaAlertas" style="margin-top:20px;"></div>

          <div id="zonaGuardar" style="margin-top:20px; display:none;">
            <p class="texto-muted" id="resumenGuardar" style="margin-bottom:10px;"></p>
            <button id="btnGuardar" class="btn-primario">Guardar observaciones</button>
          </div>
        </main>
      </div>`;

    document.getElementById('btnVolver').addEventListener('click', () => {
      VistaDashboardCoordinadorArea.render(this.contenedor, this.perfil);
    });

    document.getElementById('inputExcel').addEventListener('change', (ev) => this.procesarArchivo(ev.target.files[0]));

    await this.cargarCaches();
  },

  async cargarCaches() {
    const [{ data: cursos }, { data: asignaturas }, { data: reglas }, { data: periodos }] = await Promise.all([
      sb.from('an_cursos').select('id, nombre'),
      sb.from('an_asignaturas').select('id, nombre').eq('area_id', this.areaId),
      sb.from('an_reglas_resolucion').select('nombre_excel_normalizado, curso_excel_normalizado, estudiante_id'),
      sb.from('an_periodos').select('id, anio, numero').order('anio', { ascending: false }).order('numero', { ascending: false }).limit(1),
    ]);

    (cursos || []).forEach(c => this.cacheCursos.set(normalizar(c.nombre), c));
    (asignaturas || []).forEach(a => this.cacheAsignaturas.set(normalizar(a.nombre), a));
    (reglas || []).forEach(r => this.cacheReglas.set(r.nombre_excel_normalizado + '|' + r.curso_excel_normalizado, r.estudiante_id));
    this.periodoId = periodos?.[0]?.id || null;

    if (!this.periodoId) {
      document.getElementById('mensajeProceso').textContent = 'No hay un periodo académico configurado todavía.';
    }
  },

  async obtenerEstudiantesDeCurso(cursoId) {
    if (this.estudiantesPorCurso.has(cursoId)) return this.estudiantesPorCurso.get(cursoId);
    const { data } = await sb.from('an_estudiantes').select('id, nombre_completo, nombre_normalizado').eq('curso_id', cursoId);
    const lista = data || [];
    this.estudiantesPorCurso.set(cursoId, lista);
    return lista;
  },

  encontrarAsignatura(nombreHoja) {
    const normHoja = normalizar(nombreHoja);
    if (this.cacheAsignaturas.has(normHoja)) return this.cacheAsignaturas.get(normHoja);
    for (const [nombreNorm, asig] of this.cacheAsignaturas.entries()) {
      if (nombreNorm.includes(normHoja) || normHoja.includes(nombreNorm)) return asig;
    }
    return null;
  },

  extraerFila(fila) {
    const CLAVES_NOMBRE = ['Nombre', 'NOMBRE', 'nombre', 'Estudiante', 'ESTUDIANTE', 'estudiante'];
    const CLAVES_CURSO = ['Curso', 'CURSO', 'curso', 'Grupo', 'GRUPO', 'grupo'];
    const CLAVES_OBS = ['Observación', 'OBSERVACIÓN', 'observacion', 'Observacion', 'OBSERVACION'];

    const claveNombre = CLAVES_NOMBRE.find(k => fila[k] !== undefined);
    const claveCurso = CLAVES_CURSO.find(k => fila[k] !== undefined);
    let claveObs = CLAVES_OBS.find(k => fila[k] !== undefined);

    if (!claveObs) {
      // si no hay una columna con nombre estándar de observación, se toma la
      // primera columna que no sea ni el nombre ni el curso (ej. la columna
      // se llama igual que la asignatura, como "Tecnología")
      claveObs = Object.keys(fila).find(k => k !== claveNombre && k !== claveCurso);
    }

    return {
      nombre: String(fila[claveNombre] ?? '').trim(),
      curso: String(fila[claveCurso] ?? '').trim(),
      observacion: String(fila[claveObs] ?? '').trim(),
    };
  },

  async procesarArchivo(archivo) {
    if (!archivo || !this.periodoId) return;
    document.getElementById('mensajeProceso').textContent = 'Leyendo el archivo...';

    const buffer = await archivo.arrayBuffer();
    const libro = XLSX.read(buffer, { type: 'array' });

    let totalFilas = 0;

    for (const nombreHoja of libro.SheetNames) {
      const asignatura = this.encontrarAsignatura(nombreHoja);
      if (!asignatura) continue; // hoja que no corresponde a ninguna asignatura del área, se ignora

      const hoja = libro.Sheets[nombreHoja];
      const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

      for (const filaCruda of filas) {
        const { nombre: nombreExcel, curso: cursoExcel, observacion } = this.extraerFila(filaCruda);
        if (!nombreExcel || !cursoExcel) continue;
        totalFilas++;

        const curso = this.cacheCursos.get(normalizar(cursoExcel));
        if (!curso) {
          this.alertas.push({ tipo: 'curso_no_encontrado', nombreExcel, cursoExcel, asignaturaId: asignatura.id, texto: observacion, id: crypto.randomUUID() });
          continue;
        }

        const estudiantes = await this.obtenerEstudiantesDeCurso(curso.id);
        const nombreNorm = normalizar(nombreExcel);
        let match = estudiantes.find(e => e.nombre_normalizado === nombreNorm);

        if (!match) {
          const reglaId = this.cacheReglas.get(nombreNorm + '|' + normalizar(cursoExcel));
          if (reglaId) match = estudiantes.find(e => e.id === reglaId);
        }

        if (match) {
          this.filasResueltas.push({ estudiante_id: match.id, asignatura_id: asignatura.id, texto: observacion || 'No hay observación registrada' });
        } else {
          this.alertas.push({
            tipo: 'estudiante_no_encontrado', nombreExcel, cursoExcel, cursoId: curso.id,
            asignaturaId: asignatura.id, texto: observacion, id: crypto.randomUUID(),
          });
        }
      }

      // Estudiantes del curso(s) tocado(s) en esta hoja que no aparecieron -> alerta de faltante
      const cursosEnHoja = new Set(filas.map(f => normalizar(this.extraerFila(f).curso)).filter(Boolean));
      for (const cursoNorm of cursosEnHoja) {
        const curso = this.cacheCursos.get(cursoNorm);
        if (!curso) continue;
        const estudiantes = await this.obtenerEstudiantesDeCurso(curso.id);
        const resueltosEnCursoAsig = new Set(
          this.filasResueltas.filter(f => f.asignatura_id === asignatura.id).map(f => f.estudiante_id)
        );
        estudiantes.forEach(e => {
          if (!resueltosEnCursoAsig.has(e.id)) {
            this.alertas.push({
              tipo: 'estudiante_sin_observacion', estudianteId: e.id, nombreExcel: e.nombre_completo,
              cursoExcel: curso.nombre, asignaturaId: asignatura.id, id: crypto.randomUUID(),
            });
          }
        });
      }
    }

    document.getElementById('mensajeProceso').textContent = `${totalFilas} filas leídas · ${this.filasResueltas.length} resueltas automáticamente · ${this.alertas.length} alertas por revisar`;
    this.pintarAlertas();
  },

  pintarAlertas() {
    const zona = document.getElementById('zonaAlertas');
    if (this.alertas.length === 0) {
      zona.innerHTML = '';
      this.mostrarBotonGuardar();
      return;
    }

    zona.innerHTML = `<p class="titulo-lista">Alertas de conciliación (${this.alertas.filter(a => !a.resuelta).length} pendientes)</p>` +
      this.alertas.map(a => this.pintarAlerta(a)).join('');

    this.alertas.forEach(a => {
      if (a.resuelta) return;
      if (a.tipo === 'estudiante_sin_observacion') {
        document.getElementById('confirmar-' + a.id).addEventListener('click', () => this.resolverSinObservacion(a));
      } else {
        const btnBuscar = document.getElementById('buscar-' + a.id);
        const select = document.getElementById('select-' + a.id);
        if (btnBuscar && select) {
          btnBuscar.addEventListener('click', () => this.resolverVinculando(a, select.value));
        }
      }
    });

    this.mostrarBotonGuardar();
  },

  pintarAlerta(a) {
    if (a.resuelta) {
      return `<div class="tarjeta-alerta tarjeta-alerta-resuelta"><i class="ti ti-check" aria-hidden="true"></i> ${escapeHtml(a.nombreExcel)} — resuelta</div>`;
    }
    if (a.tipo === 'estudiante_sin_observacion') {
      return `
        <div class="tarjeta-alerta tarjeta-alerta-warning">
          <p class="alerta-titulo">Estudiante sin observación en el Excel</p>
          <p class="alerta-texto"><strong>${escapeHtml(a.nombreExcel)}</strong> — ${escapeHtml(a.cursoExcel)}</p>
          <button id="confirmar-${a.id}" class="btn-secundario btn-pequeno">Confirmar: no hay observación</button>
        </div>`;
    }
    const estudiantesCurso = a.cursoId ? (this.estudiantesPorCurso.get(a.cursoId) || []) : [];
    const opciones = estudiantesCurso.map(e => `<option value="${e.id}">${escapeHtml(e.nombre_completo)}</option>`).join('');
    return `
      <div class="tarjeta-alerta tarjeta-alerta-danger">
        <p class="alerta-titulo">${a.tipo === 'curso_no_encontrado' ? 'Curso no encontrado' : 'Estudiante no encontrado'}</p>
        <p class="alerta-texto">El Excel dice <strong>"${escapeHtml(a.nombreExcel)}"</strong> en <strong>${escapeHtml(a.cursoExcel)}</strong></p>
        ${estudiantesCurso.length ? `
          <select id="select-${a.id}" style="margin-bottom:8px;"><option value="">Buscar estudiante del curso...</option>${opciones}</select>
          <button id="buscar-${a.id}" class="btn-secundario btn-pequeno">Vincular</button>
        ` : `<p class="texto-muted">No se encontró ese curso en el sistema — verifica el nombre en el Excel.</p>`}
      </div>`;
  },

  resolverSinObservacion(a) {
    this.filasResueltas.push({ estudiante_id: a.estudianteId, asignatura_id: a.asignaturaId, texto: 'No hay observación registrada' });
    a.resuelta = true;
    this.pintarAlertas();
  },

  async resolverVinculando(a, estudianteId) {
    if (!estudianteId) return;
    this.filasResueltas.push({ estudiante_id: estudianteId, asignatura_id: a.asignaturaId, texto: a.texto || 'No hay observación registrada' });

    // Guardar como regla permanente para futuras cargas
    await sb.from('an_reglas_resolucion').upsert({
      nombre_excel_normalizado: normalizar(a.nombreExcel),
      curso_excel_normalizado: normalizar(a.cursoExcel),
      estudiante_id: estudianteId,
      creado_por: this.perfil.id,
    }, { onConflict: 'nombre_excel_normalizado,curso_excel_normalizado' });

    a.resuelta = true;
    this.pintarAlertas();
  },

  mostrarBotonGuardar() {
    const zona = document.getElementById('zonaGuardar');
    const pendientes = this.alertas.filter(a => !a.resuelta).length;
    if (this.filasResueltas.length === 0) { zona.style.display = 'none'; return; }

    const { filas: filasUnicas, duplicadas } = this.deduplicarFilas();

    zona.style.display = 'block';
    const partes = [`${filasUnicas.length} observaciones distintas listas para guardar`];
    if (duplicadas > 0) partes.push(`${duplicadas} filas duplicadas del mismo estudiante+asignatura se combinaron en una sola`);
    if (pendientes > 0) partes.push(`${pendientes} alertas sin resolver quedarán pendientes`);
    document.getElementById('resumenGuardar').textContent = partes.join(' · ');

    document.getElementById('btnGuardar').onclick = () => this.guardarTodo();
  },

  // Postgres no permite que un mismo lote de upsert toque la misma llave
  // (estudiante+asignatura+periodo) dos veces — si el Excel trae al mismo
  // estudiante repetido, nos quedamos con la última observación.
  deduplicarFilas() {
    const mapa = new Map();
    for (const f of this.filasResueltas) {
      mapa.set(`${f.estudiante_id}|${f.asignatura_id}`, f);
    }
    return { filas: [...mapa.values()], duplicadas: this.filasResueltas.length - mapa.size };
  },

  async guardarTodo() {
    const boton = document.getElementById('btnGuardar');
    boton.disabled = true;
    boton.textContent = 'Guardando...';

    const { filas: filasUnicas } = this.deduplicarFilas();
    console.log('AULAnet: filas a guardar (distintas):', filasUnicas.length, 'de', this.filasResueltas.length, 'totales resueltas');

    try {
      const { data: carga, error: errCarga } = await sb.from('an_cargas').insert({
        coordinador_id: this.perfil.id, area_id: this.areaId, archivo_nombre: 'excel_cargado.xlsx',
        periodo_id: this.periodoId, total_filas: filasUnicas.length,
        total_alertas: this.alertas.length, estado: 'completado',
      }).select('id').single();
      if (errCarga) throw errCarga;

      const filasConCarga = filasUnicas.map(f => ({ ...f, periodo_id: this.periodoId, carga_id: carga.id }));
      const LOTE = 300;
      let guardadas = 0;
      for (let i = 0; i < filasConCarga.length; i += LOTE) {
        const lote = filasConCarga.slice(i, i + LOTE);
        const { data: insertadas, error } = await sb.from('an_observaciones')
          .upsert(lote, { onConflict: 'estudiante_id,asignatura_id,periodo_id' })
          .select('id');
        if (error) { console.error('AULAnet: error en lote', i, error); throw error; }
        guardadas += insertadas?.length || 0;
        console.log(`AULAnet: lote ${i}-${i + lote.length} guardado, ${insertadas?.length} filas confirmadas por Supabase`);
      }

      document.getElementById('mensajeProceso').textContent = `✓ ${guardadas} observaciones guardadas correctamente (Supabase confirmó ${guardadas} de ${filasConCarga.length} enviadas).`;
      boton.textContent = 'Guardado';
    } catch (e) {
      console.error('AULAnet: fallo guardando observaciones', e);
      boton.disabled = false;
      boton.textContent = 'Guardar observaciones';
      document.getElementById('mensajeProceso').textContent = 'Ocurrió un error guardando: ' + (e.message || 'revisa la consola (F12)');
    }
  },
};
