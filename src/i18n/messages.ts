import type { Catalog } from './i18n.ts';

const es = {
  errors: {
    badRequest: 'La solicitud no es válida',
    validation: 'Datos de entrada inválidos',
    unauthorized: 'Debes iniciar sesión para continuar',
    forbidden: 'No tienes permiso para realizar esta acción',
    notFound: 'El recurso solicitado no existe',
    routeNotFound: 'La ruta {path} no existe',
    conflict: 'El recurso ya existe',
    payloadTooLarge: 'La solicitud supera el tamaño máximo permitido',
    unsupportedMediaType: 'El tipo de contenido no está permitido',
    internal: 'Ha ocurrido un error inesperado',
    serviceUnavailable: 'El servicio no está disponible en este momento',
  },
} as const satisfies Catalog;

const en = {
  errors: {
    badRequest: 'The request is not valid',
    validation: 'Invalid input data',
    unauthorized: 'You must sign in to continue',
    forbidden: 'You are not allowed to perform this action',
    notFound: 'The requested resource does not exist',
    routeNotFound: 'The route {path} does not exist',
    conflict: 'The resource already exists',
    payloadTooLarge: 'The request exceeds the maximum allowed size',
    unsupportedMediaType: 'The content type is not allowed',
    internal: 'An unexpected error occurred',
    serviceUnavailable: 'The service is not available right now',
  },
} as const satisfies Catalog;

export const BUILT_IN_CATALOGS: Readonly<Record<string, Catalog>> = { en, es };
export const BUILT_IN_DEFAULT_LOCALE = 'en';
