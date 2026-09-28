-- BAB AL FKAMAH — crée le compte MySQL utilisé par l'application (à exécuter en root, une seule fois)
CREATE USER IF NOT EXISTS 'resto'@'localhost' IDENTIFIED BY 'resto_pass';
CREATE USER IF NOT EXISTS 'resto'@'%' IDENTIFIED BY 'resto_pass';
GRANT ALL PRIVILEGES ON bab_al_fkamah.* TO 'resto'@'localhost';
GRANT ALL PRIVILEGES ON bab_al_fkamah.* TO 'resto'@'%';
FLUSH PRIVILEGES;
