-- 1. Permitimos participantes sin cuenta de usuario asociada
ALTER TABLE public.session_participants ALTER COLUMN user_id DROP NOT NULL;

-- 2. Creamos la función para que el frontend agregue al invitado
CREATE OR REPLACE FUNCTION public.add_guest_participant(
  p_session_id uuid,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_participant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  
  IF NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = p_session_id AND user_id = auth.uid()) THEN 
    RAISE EXCEPTION 'NOT_PARTICIPANT'; 
  END IF;
  
  INSERT INTO public.session_participants(session_id, display_name)
  VALUES (p_session_id, trim(p_display_name))
  RETURNING id INTO v_participant_id;
  
  RETURN v_participant_id;
END;
$$;

-- 3. Creamos la función para transferirle los ítems
CREATE OR REPLACE FUNCTION public.reassign_order_items(
  p_item_ids uuid[],
  p_new_participant_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  
  SELECT session_id INTO v_session_id FROM public.session_participants WHERE id = p_new_participant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PARTICIPANT'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.session_participants WHERE session_id = v_session_id AND user_id = auth.uid()) THEN 
    RAISE EXCEPTION 'NOT_PARTICIPANT'; 
  END IF;

  UPDATE public.order_items 
  SET participant_id = p_new_participant_id 
  WHERE id = ANY(p_item_ids) 
  AND order_id IN (SELECT id FROM public.orders WHERE session_id = v_session_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_guest_participant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_order_items(uuid[], uuid) TO authenticated;