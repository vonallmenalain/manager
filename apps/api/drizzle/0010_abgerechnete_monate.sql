ALTER TABLE `donations` ADD `covers_months` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Bisher hielt eine Zahlung fest, bis zu welchem Monat sie abrechnet. Neu
-- zählt sie die Monate einzeln auf – "bis und mit März" ist "1,2,3".
UPDATE `donations` SET `covers_months` = CASE `covers_through_month`
  WHEN 1 THEN '1'
  WHEN 2 THEN '1,2'
  WHEN 3 THEN '1,2,3'
  WHEN 4 THEN '1,2,3,4'
  WHEN 5 THEN '1,2,3,4,5'
  WHEN 6 THEN '1,2,3,4,5,6'
  WHEN 7 THEN '1,2,3,4,5,6,7'
  WHEN 8 THEN '1,2,3,4,5,6,7,8'
  WHEN 9 THEN '1,2,3,4,5,6,7,8,9'
  WHEN 10 THEN '1,2,3,4,5,6,7,8,9,10'
  WHEN 11 THEN '1,2,3,4,5,6,7,8,9,10,11'
  WHEN 12 THEN '1,2,3,4,5,6,7,8,9,10,11,12'
  ELSE ''
END;--> statement-breakpoint
-- In `tax_applied_cents` stand der verrechnete Steuerbetrag, der das
-- Einkommen minderte. Neu steht dort, um wie viel der Zehnte dadurch kleiner
-- wird – und das ist ein Zehntel davon. Ohne diese Umrechnung wäre jede
-- bestehende Zahlung mit dem Zehnfachen gutgeschrieben.
UPDATE `donations` SET `tax_applied_cents` = CAST(ROUND(`tax_applied_cents` / 10.0) AS INTEGER);
