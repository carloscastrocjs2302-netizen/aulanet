// =====================================================================
// AULANET · AUTENTICACIÓN
// =====================================================================

const Auth = {
  // Inicia sesión con correo institucional + contraseña
  async iniciarSesion(correo, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email: correo, password });
    if (error) throw error;
    return data;
  },

  async cerrarSesion() {
    await sb.auth.signOut();
  },

  // Devuelve la sesión activa de Supabase Auth, o null si no hay
  async obtenerSesion() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },

  // Trae el perfil completo del docente autenticado desde an_docentes,
  // junto con sus asignaciones (curso, ciclo, área) para armar el menú
  async obtenerPerfilCompleto() {
    const sesion = await this.obtenerSesion();
    if (!sesion) return null;

    const { data: docente, error } = await sb
      .from('an_docentes')
      .select('*')
      .eq('id', sesion.user.id)
      .single();
    if (error) throw error;

    const [{ data: cursos }, { data: ciclos }, { data: areas }] = await Promise.all([
      sb.from('an_asignaciones_curso').select('rol_asignacion, an_cursos(id, nombre, nivel)').eq('docente_id', docente.id),
      sb.from('an_asignaciones_ciclo').select('grado').eq('docente_id', docente.id),
      sb.from('an_docente_areas_coordinadas').select('nivel, an_areas(id, nombre)').eq('docente_id', docente.id),
    ]);

    return {
      ...docente,
      cursos_dirigidos: (cursos || []).filter(c => c.rol_asignacion === 'director').map(c => c.an_cursos),
      cursos_codirigidos: (cursos || []).filter(c => c.rol_asignacion === 'codirector').map(c => c.an_cursos),
      grados_ciclo: (ciclos || []).map(c => c.grado),
      areas_coordinadas: (areas || []).map(a => ({ area: a.an_areas, nivel: a.nivel })),
    };
  },

  // Cambia la contraseña y marca al docente como "confirmado" (ya no
  // está usando la contraseña temporal)
  async cambiarPasswordYConfirmar(nuevaPassword) {
    const { error: errPass } = await sb.auth.updateUser({ password: nuevaPassword });
    if (errPass) throw errPass;

    const sesion = await this.obtenerSesion();
    const { error: errDoc } = await sb
      .from('an_docentes')
      .update({ confirmado: true })
      .eq('id', sesion.user.id);
    if (errDoc) throw errDoc;
  },
};
