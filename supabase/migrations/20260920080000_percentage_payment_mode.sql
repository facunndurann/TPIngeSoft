-- MI-43: falta el modo de pago que corresponde a la división por porcentajes.
-- Los valores de un enum se confirman antes de que otra migración los use, así
-- que este archivo solo lo agrega (mismo procedimiento que member_role en
-- 20260919000000_employee_roles).
--
-- Se llama percentage_split por simetría con equal_split: el modo describe con
-- qué regla se calculó el importe de ese movimiento, no cuánto se cobró.
alter type public.payment_mode add value if not exists 'percentage_split';
