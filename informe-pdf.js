// =====================================================================
// AULANET · VISTA: INFORME PDF DE OBSERVACIONES
// =====================================================================
// Genera una vista imprimible fiel al diseño aprobado. El usuario usa
// "Imprimir" del navegador y elige "Guardar como PDF" — sin librerías
// externas ni Edge Functions.
// =====================================================================

const VistaInformePDF = {
  async render(contenedor, perfil, estudiante, volverA) {
    contenedor.innerHTML = `
      <div class="app-shell">
        <header class="barra-superior no-imprimir">
          <p class="logo-texto-chico"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
          <div class="acciones-barra">
            <button id="btnVolverPdf" class="btn-icono" aria-label="Volver"><i class="ti ti-arrow-left" aria-hidden="true"></i></button>
            <button id="btnImprimir" class="btn-primario">Imprimir / Guardar PDF</button>
          </div>
        </header>
        <main id="hojaInforme" class="hoja-informe">
          <p class="texto-muted">Generando informe...</p>
        </main>
      </div>`;

    document.getElementById('btnVolverPdf').addEventListener('click', () => volverA());
    document.getElementById('btnImprimir').addEventListener('click', () => window.print());

    await this.pintarInforme(estudiante);
  },

  async pintarInforme(estudiante) {
    try {
      const [{ data: periodos }, { data: cursoInfo }] = await Promise.all([
        sb.from('an_periodos').select('id, anio, numero, nombre_informe').order('anio', { ascending: false }).order('numero', { ascending: false }).limit(1),
        sb.from('an_cursos').select('nombre').eq('id', estudiante.curso_id).single(),
      ]);
      const periodoActual = periodos?.[0];
      if (!periodoActual) { document.getElementById('hojaInforme').innerHTML = '<p>No hay periodo activo.</p>'; return; }

      const { data: director } = await sb
        .from('an_asignaciones_curso')
        .select('an_docentes(nombre_completo)')
        .eq('curso_id', estudiante.curso_id).eq('rol_asignacion', 'director').limit(1).single();

      const { data: observaciones } = await sb
        .from('an_observaciones')
        .select('texto, an_asignaturas(nombre, an_areas(nombre))')
        .eq('estudiante_id', estudiante.id)
        .eq('periodo_id', periodoActual.id);

      // Agrupar por ÁREA (no por asignatura) para que coincida con el diseño aprobado
      const porArea = new Map();
      (observaciones || []).forEach(o => {
        const nombreArea = o.an_asignaturas?.an_areas?.nombre || o.an_asignaturas?.nombre || 'Otra';
        if (!porArea.has(nombreArea)) porArea.set(nombreArea, []);
        porArea.get(nombreArea).push(o.texto);
      });

      const fechaHoy = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

      const filasAreas = [...porArea.entries()].map(([area, textos]) => `
        <div class="fila-area-informe">
          <p class="nombre-area-informe">${escapeHtml(area)}</p>
          <p class="texto-area-informe">${escapeHtml(textos.join(' '))}</p>
        </div>`).join('');

      document.getElementById('hojaInforme').innerHTML = `
        <div class="pagina-informe">
          <div class="encabezado-informe">
            <img src="data:image/png;base64,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" alt="Cafam" class="logo-cafam-img" />
            <div>
              <p class="titulo-informe">Informe cualitativo</p>
              <p class="subtitulo-informe">${escapeHtml(periodoActual.nombre_informe || (periodoActual.numero + 'º periodo'))} académico · Colegio Cafam</p>
            </div>
          </div>

          <div class="datos-informe">
            <div><p class="label-informe">Estudiante</p><p class="valor-informe">${escapeHtml(estudiante.nombre_completo)}</p></div>
            <div><p class="label-informe">Curso</p><p class="valor-informe">${escapeHtml(cursoInfo?.nombre || '')}</p></div>
            <div><p class="label-informe">Director de curso</p><p class="valor-informe-normal">${escapeHtml(director?.an_docentes?.nombre_completo || '—')}</p></div>
            <div><p class="label-informe">Fecha de generación</p><p class="valor-informe-normal">${fechaHoy}</p></div>
          </div>

          <div class="areas-informe">
            ${filasAreas || '<p class="texto-muted">Sin observaciones registradas todavía.</p>'}
          </div>

          <div class="pie-informe"><span>Generado por AULAnet</span></div>
        </div>`;
    } catch (e) {
      console.error(e);
      document.getElementById('hojaInforme').innerHTML = '<p>No pudimos generar el informe.</p>';
    }
  },
};
