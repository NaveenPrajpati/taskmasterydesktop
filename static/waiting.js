// main.ts passes the site's login page as ?login=
const login = new URLSearchParams(location.search).get('login');
if (login) document.getElementById('back').href = login;
