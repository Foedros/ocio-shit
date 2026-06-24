<script>
  // Single-user sign-in (Supabase Auth, publishable key). RLS scopes everything to this account.
  import { signInAction } from '$lib/boot-supabase.js';
  import { busy } from '$lib/stores.js';
  import Button from './Button.svelte';

  let email = $state('');
  let password = $state('');
  let error = $state('');

  async function submit(e) {
    e.preventDefault();
    error = '';
    const ok = await signInAction(email.trim(), password);
    if (!ok) error = 'No se pudo entrar. Revisa el correo y la contraseña.';
  }
</script>

<div class="login">
  <div class="mark">◇</div>
  <h1>Ocio Shit</h1>
  <p class="sub">Tu archivo cultural de por vida. Entra para abrirlo.</p>
  <form onsubmit={submit}>
    <label>
      <span>Correo</span>
      <input type="email" bind:value={email} autocomplete="username" required placeholder="tu-email@ejemplo.com" />
    </label>
    <label>
      <span>Contraseña</span>
      <input type="password" bind:value={password} autocomplete="current-password" required />
    </label>
    {#if error}<p class="err">{error}</p>{/if}
    <Button variant="primary" type="submit" disabled={!!$busy}>{$busy ? 'Entrando…' : 'Entrar'}</Button>
  </form>
</div>

<style>
  .login {
    max-width: 22rem;
    margin: 3.5rem auto 0;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
  }
  .mark {
    color: var(--accent);
    font-size: 2rem;
  }
  h1 {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 1.8rem;
    margin: 0;
  }
  .sub {
    color: var(--ink-2);
    margin: 0 0 1.4rem;
    line-height: 1.5;
  }
  form {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    text-align: left;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  label span {
    font-size: 0.82rem;
    color: var(--ink-3);
  }
  input {
    background: var(--surface, var(--bg));
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.6rem 0.7rem;
    color: var(--ink);
    font-size: 1rem;
    font-family: inherit;
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .err {
    color: var(--danger, #c0392b);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
