
init:
	brew update 
	brew install sqlite3
	npm install
	echo "sqlite3 main.db"
	echo "\
		CREATE TABLE users (id integer not null primary key, email text unique not null, hashedpassword text not null);\
		CREATE TABLE posts (id integer not null primary key, content text not null, title text not null, createdat datetime default current_timestamp, updatedat datetime datetime default current_timestamp, userid integer references users(id));"

