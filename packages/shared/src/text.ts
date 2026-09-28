/**
 * Una cantidad con su sustantivo en singular o en plural: «1 mesa», «3 mesas».
 * El plural se puede dar explícito porque no siempre es sumar una s
 * («comensal» → «comensales»).
 */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}
