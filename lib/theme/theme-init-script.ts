/**
 * Inline script for optional pre-hydration theme restore on admin routes.
 * System preference works without this script via CSS @media (prefers-color-scheme).
 */
import { ADMIN_ROUTE_PREFIXES } from './routes'

const ADMIN_PREFIXES_JSON = JSON.stringify(ADMIN_ROUTE_PREFIXES)

export const THEME_INIT_SCRIPT = `(function(){try{var prefixes=${ADMIN_PREFIXES_JSON};var p=window.location.pathname;var a=prefixes.some(function(x){return p.indexOf(x)===0;});var r=document.documentElement;if(!a){r.setAttribute('data-theme','light');r.classList.add('light');r.classList.remove('dark');return;}var s=localStorage.getItem('aubrey_theme');if(s==='light'){r.setAttribute('data-theme','light');r.classList.add('light');r.classList.remove('dark');}else if(s==='dark'){r.setAttribute('data-theme','dark');r.classList.add('dark');r.classList.remove('light');}else{r.removeAttribute('data-theme');r.classList.remove('light','dark');}}catch(e){}})();`
