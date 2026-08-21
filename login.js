// =====================================================================
// AULANET · VISTA: LOGIN
// =====================================================================

const VistaLogin = {
  render(contenedor, mensajeError) {
    contenedor.innerHTML = `
      <div class="pantalla-centrada">
        <div class="tarjeta-login">
          <div class="logo-aulanet">
            <div class="logo-icono"><i class="ti ti-hierarchy-3" aria-hidden="true"></i></div>
            <p class="logo-texto"><span class="logo-aula">AULA</span><span class="logo-net">net</span></p>
            <p class="logo-tagline">red de información académica</p>
          </div>

          <form id="formLogin" novalidate>
            <label for="inputCorreo">Correo institucional</label>
            <input type="email" id="inputCorreo" placeholder="nombre.apellido@colegio.cafam.edu.co" required autocomplete="username" />

            <label for="inputPassword">Contraseña</label>
            <input type="password" id="inputPassword" placeholder="••••••••" required autocomplete="current-password" />

            <p id="errorLogin" class="mensaje-error" style="display:none;"></p>

            <button type="submit" id="btnLogin" class="btn-primario btn-ancho">Iniciar sesión</button>
          </form>
        </div>
      </div>`;

    if (mensajeError) mostrarError(mensajeError, 'errorLogin');

    document.getElementById('formLogin').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      ocultarError('errorLogin');

      const correo = document.getElementById('inputCorreo').value.trim();
      const password = document.getElementById('inputPassword').value;
      if (!correo || !password) {
        mostrarError('Ingresa tu correo y tu contraseña.', 'errorLogin');
        return;
      }

      const boton = document.getElementById('btnLogin');
      boton.disabled = true;
      boton.textContent = 'Entrando...';

      try {
        await Auth.iniciarSesion(correo, password);
        // App.decidirVista() se dispara solo por el listener de onAuthStateChange
      } catch (e) {
        boton.disabled = false;
        boton.textContent = 'Iniciar sesión';
        const msg = e.message?.includes('Invalid login credentials')
          ? 'Correo o contraseña incorrectos.'
          : 'No pudimos iniciar sesión. Intenta de nuevo.';
        mostrarError(msg, 'errorLogin');
      }
    });
  },
};
