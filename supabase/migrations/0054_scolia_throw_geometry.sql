alter table public.throws
  add column impact_x_mm numeric,
  add column impact_y_mm numeric,
  add column angle_horizontal_deg numeric,
  add column angle_vertical_deg numeric;

alter table public.throws
  add constraint throws_impact_x_range check (impact_x_mm is null or impact_x_mm between -250 and 250),
  add constraint throws_impact_y_range check (impact_y_mm is null or impact_y_mm between -250 and 250),
  add constraint throws_angle_horizontal_range check (angle_horizontal_deg is null or angle_horizontal_deg between -90 and 90),
  add constraint throws_angle_vertical_range check (angle_vertical_deg is null or angle_vertical_deg between -90 and 90);
