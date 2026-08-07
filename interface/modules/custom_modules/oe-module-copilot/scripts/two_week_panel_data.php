<?php

/**
 * Panel data for seed_two_week_panel.php — 16 synthetic patients owned by provider 6.
 * The first 6 mirror seed_demo_panel.php (kept + given vitals/labs); the next 10 are new.
 * Vitals are in US units (mmHg / lb / in / degF / % / kg-m2). Labs carry a LOINC code.
 *
 * @package OpenEMR
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

return [
    // ---- original 6 (kept; vitals + labs added) ----
    ['fname' => 'Marcus', 'lname' => 'Fielding', 'sex' => 'Male', 'dob' => '1958-03-22',
     'problems' => [['title' => 'Type 2 diabetes mellitus', 'code' => 'ICD10:E11.9', 'begdate' => '2021-05-10'], ['title' => 'Essential hypertension', 'code' => 'ICD10:I10', 'begdate' => '2019-02-01']],
     'allergies' => [], 'meds' => [['drug' => 'Metformin', 'dosage' => '500 mg BID'], ['drug' => 'Lisinopril', 'dosage' => '10 mg daily']],
     'vitals' => ['bps' => 142, 'bpd' => 86, 'pulse' => 78, 'resp' => 16, 'temp_f' => 98.4, 'weight_lb' => 198, 'height_in' => 70, 'oxygen_sat' => 98, 'bmi' => 28.4],
     'labs' => [['loinc' => '4548-4', 'name' => 'Hemoglobin A1c', 'value' => '7.2', 'unit' => '%', 'range' => '4.0-5.6', 'abnormal' => 'high'], ['loinc' => '2345-7', 'name' => 'Glucose', 'value' => '146', 'unit' => 'mg/dL', 'range' => '70-99', 'abnormal' => 'high']]],

    ['fname' => 'Rosa', 'lname' => 'Alvarez', 'sex' => 'Female', 'dob' => '1971-11-05',
     'problems' => [['title' => 'Acute sinusitis', 'code' => 'ICD10:J01.90', 'begdate' => '2026-07-01']],
     'allergies' => [['title' => 'Penicillin', 'code' => 'RXNORM:7980', 'begdate' => '2010-01-01']], 'meds' => [['drug' => 'Amoxicillin', 'dosage' => '500 mg TID']],
     'vitals' => ['bps' => 122, 'bpd' => 76, 'pulse' => 82, 'resp' => 18, 'temp_f' => 100.1, 'weight_lb' => 152, 'height_in' => 65, 'oxygen_sat' => 98, 'bmi' => 25.3],
     'labs' => []],

    ['fname' => 'Harold', 'lname' => 'Kim', 'sex' => 'Male', 'dob' => '1949-07-14',
     'problems' => [['title' => 'Hyperlipidemia', 'code' => 'ICD10:E78.5', 'begdate' => '2018-09-12']],
     'allergies' => [], 'meds' => [['drug' => 'Atorvastatin', 'dosage' => '40 mg daily'], ['drug' => 'Simvastatin', 'dosage' => '20 mg daily']],
     'vitals' => ['bps' => 130, 'bpd' => 80, 'pulse' => 68, 'resp' => 16, 'temp_f' => 98.2, 'weight_lb' => 176, 'height_in' => 69, 'oxygen_sat' => 98, 'bmi' => 26.0],
     'labs' => [['loinc' => '2093-3', 'name' => 'Cholesterol total', 'value' => '224', 'unit' => 'mg/dL', 'range' => '0-200', 'abnormal' => 'high'], ['loinc' => '13457-7', 'name' => 'LDL cholesterol', 'value' => '148', 'unit' => 'mg/dL', 'range' => '0-100', 'abnormal' => 'high'], ['loinc' => '2085-9', 'name' => 'HDL cholesterol', 'value' => '38', 'unit' => 'mg/dL', 'range' => '40-60', 'abnormal' => 'low'], ['loinc' => '2571-8', 'name' => 'Triglycerides', 'value' => '210', 'unit' => 'mg/dL', 'range' => '0-150', 'abnormal' => 'high']]],

    ['fname' => 'Denise', 'lname' => 'Carter', 'sex' => 'Female', 'dob' => '1985-02-28',
     'problems' => [['title' => 'Asthma', 'code' => 'ICD10:J45.909', 'begdate' => '2015-03-20']],
     'allergies' => [], 'meds' => [['drug' => 'Albuterol', 'dosage' => '90 mcg PRN']],
     'vitals' => ['bps' => 118, 'bpd' => 74, 'pulse' => 80, 'resp' => 20, 'temp_f' => 98.6, 'weight_lb' => 138, 'height_in' => 64, 'oxygen_sat' => 95, 'bmi' => 23.7],
     'labs' => []],

    ['fname' => 'Frank', 'lname' => 'Nguyen', 'sex' => 'Male', 'dob' => '1962-09-09',
     'problems' => [['title' => 'Congestive heart failure', 'code' => 'ICD10:I50.9', 'begdate' => '2022-11-03'], ['title' => 'Atrial fibrillation', 'code' => 'ICD10:I48.91', 'begdate' => '2023-04-18']],
     'allergies' => [['title' => 'Sulfa drugs', 'code' => 'RXNORM:10180', 'begdate' => '2005-01-01']], 'meds' => [['drug' => 'Furosemide', 'dosage' => '40 mg daily'], ['drug' => 'Warfarin', 'dosage' => '5 mg daily'], ['drug' => 'Metoprolol', 'dosage' => '50 mg BID']],
     'vitals' => ['bps' => 126, 'bpd' => 78, 'pulse' => 74, 'resp' => 18, 'temp_f' => 98.1, 'weight_lb' => 194, 'height_in' => 70, 'oxygen_sat' => 96, 'bmi' => 27.8],
     'labs' => [['loinc' => '6301-6', 'name' => 'INR', 'value' => '2.4', 'unit' => '{INR}', 'range' => '2.0-3.0', 'abnormal' => 'normal'], ['loinc' => '2160-0', 'name' => 'Creatinine', 'value' => '1.3', 'unit' => 'mg/dL', 'range' => '0.7-1.3', 'abnormal' => 'normal']]],

    ['fname' => 'Grace', 'lname' => 'Bello', 'sex' => 'Female', 'dob' => '1990-06-18',
     'problems' => [['title' => 'Migraine', 'code' => 'ICD10:G43.909', 'begdate' => '2017-08-08']],
     'allergies' => [], 'meds' => [['drug' => 'Sumatriptan', 'dosage' => '50 mg PRN']],
     'vitals' => ['bps' => 116, 'bpd' => 72, 'pulse' => 70, 'resp' => 16, 'temp_f' => 98.5, 'weight_lb' => 142, 'height_in' => 66, 'oxygen_sat' => 99, 'bmi' => 22.9],
     'labs' => []],

    // ---- 10 new patients ----
    ['fname' => 'Walter', 'lname' => 'Osei', 'sex' => 'Male', 'dob' => '1951-04-12',
     'problems' => [['title' => 'Chronic obstructive pulmonary disease', 'code' => 'ICD10:J44.9', 'begdate' => '2016-01-10']],
     'allergies' => [], 'meds' => [['drug' => 'Tiotropium', 'dosage' => '18 mcg daily'], ['drug' => 'Albuterol', 'dosage' => '90 mcg PRN']],
     'vitals' => ['bps' => 138, 'bpd' => 84, 'pulse' => 88, 'resp' => 20, 'temp_f' => 98.4, 'weight_lb' => 170, 'height_in' => 69, 'oxygen_sat' => 91, 'bmi' => 25.1],
     'labs' => []],

    ['fname' => 'Priya', 'lname' => 'Nair', 'sex' => 'Female', 'dob' => '1979-08-30',
     'problems' => [['title' => 'Hypothyroidism', 'code' => 'ICD10:E03.9', 'begdate' => '2014-06-01']],
     'allergies' => [], 'meds' => [['drug' => 'Levothyroxine', 'dosage' => '75 mcg daily']],
     'vitals' => ['bps' => 118, 'bpd' => 72, 'pulse' => 64, 'resp' => 16, 'temp_f' => 98.0, 'weight_lb' => 150, 'height_in' => 64, 'oxygen_sat' => 99, 'bmi' => 25.7],
     'labs' => [['loinc' => '3016-3', 'name' => 'TSH', 'value' => '4.8', 'unit' => 'mIU/L', 'range' => '0.4-4.0', 'abnormal' => 'high']]],

    ['fname' => 'James', 'lname' => 'Okoro', 'sex' => 'Male', 'dob' => '1955-12-03',
     'problems' => [['title' => 'Chronic kidney disease stage 3', 'code' => 'ICD10:N18.30', 'begdate' => '2020-03-15'], ['title' => 'Essential hypertension', 'code' => 'ICD10:I10', 'begdate' => '2012-01-01']],
     'allergies' => [], 'meds' => [['drug' => 'Lisinopril', 'dosage' => '20 mg daily'], ['drug' => 'Amlodipine', 'dosage' => '5 mg daily']],
     'vitals' => ['bps' => 146, 'bpd' => 88, 'pulse' => 76, 'resp' => 16, 'temp_f' => 98.2, 'weight_lb' => 190, 'height_in' => 70, 'oxygen_sat' => 97, 'bmi' => 27.3],
     'labs' => [['loinc' => '2160-0', 'name' => 'Creatinine', 'value' => '1.8', 'unit' => 'mg/dL', 'range' => '0.7-1.3', 'abnormal' => 'high'], ['loinc' => '33914-3', 'name' => 'eGFR', 'value' => '42', 'unit' => 'mL/min/1.73m2', 'range' => '60-120', 'abnormal' => 'low']]],

    ['fname' => 'Linda', 'lname' => 'Petrova', 'sex' => 'Female', 'dob' => '1983-05-19',
     'problems' => [['title' => 'Major depressive disorder', 'code' => 'ICD10:F33.1', 'begdate' => '2019-09-01'], ['title' => 'Gastro-esophageal reflux disease', 'code' => 'ICD10:K21.9', 'begdate' => '2021-02-10']],
     'allergies' => [], 'meds' => [['drug' => 'Sertraline', 'dosage' => '100 mg daily'], ['drug' => 'Omeprazole', 'dosage' => '20 mg daily']],
     'vitals' => ['bps' => 122, 'bpd' => 78, 'pulse' => 72, 'resp' => 16, 'temp_f' => 98.6, 'weight_lb' => 145, 'height_in' => 65, 'oxygen_sat' => 99, 'bmi' => 24.1],
     'labs' => []],

    ['fname' => 'Ahmed', 'lname' => 'Hassan', 'sex' => 'Male', 'dob' => '1968-02-25',
     'problems' => [['title' => 'Type 2 diabetes mellitus with hyperglycemia', 'code' => 'ICD10:E11.65', 'begdate' => '2015-07-01']],
     'allergies' => [], 'meds' => [['drug' => 'Metformin', 'dosage' => '1000 mg BID'], ['drug' => 'Glipizide', 'dosage' => '10 mg daily']],
     'vitals' => ['bps' => 134, 'bpd' => 82, 'pulse' => 80, 'resp' => 16, 'temp_f' => 98.4, 'weight_lb' => 210, 'height_in' => 70, 'oxygen_sat' => 98, 'bmi' => 30.1],
     'labs' => [['loinc' => '4548-4', 'name' => 'Hemoglobin A1c', 'value' => '9.1', 'unit' => '%', 'range' => '4.0-5.6', 'abnormal' => 'high'], ['loinc' => '2345-7', 'name' => 'Glucose', 'value' => '188', 'unit' => 'mg/dL', 'range' => '70-99', 'abnormal' => 'high']]],

    ['fname' => 'Sofia', 'lname' => 'Ramirez', 'sex' => 'Female', 'dob' => '1994-10-08',
     'problems' => [['title' => 'Pregnancy, first trimester', 'code' => 'ICD10:Z34.01', 'begdate' => '2026-06-01']],
     'allergies' => [], 'meds' => [['drug' => 'Prenatal vitamins', 'dosage' => '1 tab daily']],
     'vitals' => ['bps' => 110, 'bpd' => 68, 'pulse' => 78, 'resp' => 16, 'temp_f' => 98.6, 'weight_lb' => 140, 'height_in' => 63, 'oxygen_sat' => 99, 'bmi' => 24.8],
     'labs' => [['loinc' => '718-7', 'name' => 'Hemoglobin', 'value' => '11.6', 'unit' => 'g/dL', 'range' => '12.0-15.5', 'abnormal' => 'low']]],

    ['fname' => 'Robert', 'lname' => 'Chen', 'sex' => 'Male', 'dob' => '1957-06-30',
     'problems' => [['title' => 'Coronary artery disease', 'code' => 'ICD10:I25.10', 'begdate' => '2021-11-20'], ['title' => 'Old myocardial infarction', 'code' => 'ICD10:I25.2', 'begdate' => '2021-11-20']],
     'allergies' => [], 'meds' => [['drug' => 'Aspirin', 'dosage' => '81 mg daily'], ['drug' => 'Atorvastatin', 'dosage' => '80 mg daily'], ['drug' => 'Metoprolol', 'dosage' => '50 mg BID'], ['drug' => 'Clopidogrel', 'dosage' => '75 mg daily']],
     'vitals' => ['bps' => 128, 'bpd' => 76, 'pulse' => 62, 'resp' => 16, 'temp_f' => 98.2, 'weight_lb' => 185, 'height_in' => 70, 'oxygen_sat' => 98, 'bmi' => 26.5],
     'labs' => [['loinc' => '13457-7', 'name' => 'LDL cholesterol', 'value' => '78', 'unit' => 'mg/dL', 'range' => '0-100', 'abnormal' => 'normal'], ['loinc' => '2571-8', 'name' => 'Triglycerides', 'value' => '150', 'unit' => 'mg/dL', 'range' => '0-150', 'abnormal' => 'normal']]],

    ['fname' => 'Emily', 'lname' => 'Watson', 'sex' => 'Female', 'dob' => '1976-03-14',
     'problems' => [['title' => 'Essential hypertension', 'code' => 'ICD10:I10', 'begdate' => '2018-05-01'], ['title' => 'Obesity', 'code' => 'ICD10:E66.9', 'begdate' => '2018-05-01']],
     'allergies' => [['title' => 'Sulfa drugs', 'code' => 'RXNORM:10180', 'begdate' => '2008-01-01']], 'meds' => [['drug' => 'Hydrochlorothiazide', 'dosage' => '25 mg daily']],
     'vitals' => ['bps' => 152, 'bpd' => 94, 'pulse' => 84, 'resp' => 18, 'temp_f' => 98.5, 'weight_lb' => 228, 'height_in' => 64, 'oxygen_sat' => 97, 'bmi' => 39.1],
     'labs' => [['loinc' => '2823-3', 'name' => 'Potassium', 'value' => '3.4', 'unit' => 'mmol/L', 'range' => '3.5-5.0', 'abnormal' => 'low']]],

    ['fname' => 'David', 'lname' => 'Park', 'sex' => 'Male', 'dob' => '1972-09-22',
     'problems' => [['title' => 'Rheumatoid arthritis', 'code' => 'ICD10:M06.9', 'begdate' => '2017-04-01']],
     'allergies' => [], 'meds' => [['drug' => 'Methotrexate', 'dosage' => '15 mg weekly'], ['drug' => 'Folic acid', 'dosage' => '1 mg daily']],
     'vitals' => ['bps' => 124, 'bpd' => 78, 'pulse' => 70, 'resp' => 16, 'temp_f' => 98.3, 'weight_lb' => 168, 'height_in' => 69, 'oxygen_sat' => 99, 'bmi' => 24.8],
     'labs' => []],

    ['fname' => 'Nadia', 'lname' => 'Ali', 'sex' => 'Female', 'dob' => '1988-12-11',
     'problems' => [['title' => 'Iron deficiency anemia', 'code' => 'ICD10:D50.9', 'begdate' => '2025-11-01']],
     'allergies' => [], 'meds' => [['drug' => 'Ferrous sulfate', 'dosage' => '325 mg daily']],
     'vitals' => ['bps' => 108, 'bpd' => 66, 'pulse' => 90, 'resp' => 16, 'temp_f' => 98.4, 'weight_lb' => 132, 'height_in' => 64, 'oxygen_sat' => 99, 'bmi' => 22.7],
     'labs' => [['loinc' => '718-7', 'name' => 'Hemoglobin', 'value' => '9.8', 'unit' => 'g/dL', 'range' => '12.0-15.5', 'abnormal' => 'low'], ['loinc' => '2276-4', 'name' => 'Ferritin', 'value' => '8', 'unit' => 'ng/mL', 'range' => '15-150', 'abnormal' => 'low']]],
];
