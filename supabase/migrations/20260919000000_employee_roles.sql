-- Enum changes commit before the next migration uses the new values.
alter type public.member_role add value if not exists 'manager';
alter type public.member_role add value if not exists 'supervisor';
alter type public.member_role add value if not exists 'waiter';
alter type public.member_role add value if not exists 'cashier';
alter type public.member_role add value if not exists 'kitchen';
