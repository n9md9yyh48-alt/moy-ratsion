/* Deprecated non-OpenAI adapter. Deliberately disabled.
   The user selected ONLY the OpenAI assistant for "Мой рацион".
   Retained as a harmless compatibility marker, not imported by any server route. */
export function analyzeMealPhotoOpenRouter(){
  throw Object.assign(new Error("В этом приложении используется только OpenAI."),{status:503});
}
