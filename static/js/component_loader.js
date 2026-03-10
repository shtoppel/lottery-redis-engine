export async function loadComponent(targetId, path) {
  const el = document.getElementById(targetId);

  if (!el) {
    console.error(`[loadComponent] target not found: #${targetId}`);
    return;
  }

  const res = await fetch(path);

  if (!res.ok) {
    console.error(`[loadComponent] failed to fetch ${path}:`, res.status);
    return;
  }

  const html = await res.text();
  el.innerHTML = html;
}