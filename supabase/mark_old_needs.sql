-- FinFlow: one-time fix for expenses added before needs and wants existed.
-- They were all saved as "want". This marks Food, Transport, Bills and Health as needs,
-- the same categories the app now suggests as needs. Run once in the Supabase SQL editor.
-- Any single expense can still be switched afterwards by tapping its Need/Want label in the app.
update public.expenses
set kind = 'need'
where kind = 'want'
  and tag in ('Food', 'Transport', 'Bills', 'Health');
