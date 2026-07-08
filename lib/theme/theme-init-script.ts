/**
 * Inline script for optional pre-hydration theme restore on admin routes.
 * System preference works without this script via CSS @media (prefers-color-scheme).
 */
import { ADMIN_ROUTE_PREFIXES } from './routes'

const ADMIN_PREFIXES_JSON = JSON.stringify(ADMIN_ROUTE_PREFIXES)

export const THEME_INIT_SCRIPT = `(function(){try{var prefixes=${ADMIN_PREFIXES_JSON};var p=window.location.pathname;var a=prefixes.some(function(x){return p.indexOf(x)===0;});var r=document.documentElement;var darkMq=window.matchMedia('(prefers-color-scheme: dark)');function setResolved(dark){r.classList.toggle('dark',dark);r.classList.toggle('light',!dark);}if(!a){r.setAttribute('data-theme','light');setResolved(false);return;}var s=localStorage.getItem('aubrey_theme');if(s==='light'){r.setAttribute('data-theme','light');setResolved(false);}else if(s==='dark'){r.setAttribute('data-theme','dark');setResolved(true);}else{r.removeAttribute('data-theme');setResolved(darkMq.matches);}}catch(e){}})();`
