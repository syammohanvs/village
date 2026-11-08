import { proxyToVillage } from '../_proxy.js';

export const onRequest = ({ request, env }) => proxyToVillage(request, env);
