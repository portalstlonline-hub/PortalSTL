const express = require('express');
const mysql = require('mysql2');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const pastaUploads = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(pastaUploads)) {
    fs.mkdirSync(pastaUploads, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// ==========================================
// ROTAS PÚBLICAS
// ==========================================

app.get('/', async (req, res) => {
    try {
        const [categorias] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        const [patrocinados] = await db.promise().execute('SELECT * FROM empresas WHERE status = "ativo" AND plano_id = 3 ORDER BY RAND() LIMIT 3');
        res.render('index', { title: 'Portal STL', categorias, patrocinados, sucesso: req.query.sucesso });
    } catch (err) { 
        console.error('Erro na Home:', err);
        res.status(500).send('Erro interno'); 
    }
});

app.post('/contato', async (req, res) => {
    try {
        const { nome, categoria_id, whatsapp, endereco, link_maps, site, facebook, instagram } = req.body;
        const slug = (nome || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, '-').replace(/[^\w-]+/g, '');
        const query = `INSERT INTO empresas (categoria_id, plano_id, nome, slug, endereco, link_maps, whatsapp, site, facebook, instagram, status) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'inativo')`;
        await db.promise().execute(query, [categoria_id, nome, slug, endereco, link_maps || null, whatsapp, site, facebook, instagram]);
        res.redirect('/?sucesso=true#anunciar');
    } catch (err) { 
        res.redirect('/?sucesso=false#anunciar'); 
    }
});

app.get('/explorar', async (req, res) => {
    try {
        const categoriaFiltro = req.query.categoria; 
        const buscaTexto = req.query.busca;
        let queryEmpresas = 'SELECT e.*, c.nome as categoria_nome FROM empresas e LEFT JOIN categorias c ON e.categoria_id = c.id WHERE e.status = "ativo"';
        let params = [];
        
        if (categoriaFiltro) { 
            queryEmpresas += ' AND e.categoria_id = ?'; 
            params.push(categoriaFiltro); 
        }
        
        if (buscaTexto) { 
            let termoLimpo = buscaTexto.trim();
            if (termoLimpo.toLowerCase().endsWith('s') && termoLimpo.length > 3) {
                termoLimpo = termoLimpo.slice(0, -1);
            }
            const termo = `%${termoLimpo}%`;
            queryEmpresas += ' AND (e.nome LIKE ? OR c.nome LIKE ? OR c.palavras_chave LIKE ? OR e.descricao LIKE ?)'; 
            params.push(termo, termo, termo, termo); 
        }
        
        // A MÁGICA ACONTECE AQUI: Ordena por plano, e depois mistura tudo!
        queryEmpresas += ' ORDER BY e.plano_id DESC, RAND()';
        
        const [locais] = await db.promise().execute(queryEmpresas, params);
        const [categorias] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        res.render('listagem', { locais, categorias, categoriaAtual: categoriaFiltro, buscaAtual: buscaTexto });
    } catch (err) { 
        res.status(500).send('Erro interno'); 
    }
});

app.get('/local/:slug', async (req, res) => {
    try {
        const [empresas] = await db.promise().execute('SELECT * FROM empresas WHERE slug = ? AND status = "ativo"', [req.params.slug]);
        if (empresas.length === 0) return res.status(404).send('Página não encontrada ou empresa inativa.');
        res.render('detalhes', { empresa: empresas[0] });
    } catch (erro) { 
        res.status(500).send('Erro interno'); 
    }
});

app.get('/planos', (req, res) => { res.render('vendas-lojista'); });

// ==========================================
// ROTAS DO ADMIN (COM AS NOVAS CATEGORIAS)
// ==========================================

app.get('/admin', async (req, res) => {
    try {
        const [empresas] = await db.promise().execute(`SELECT empresas.*, categorias.nome as categoria_nome FROM empresas LEFT JOIN categorias ON empresas.categoria_id = categorias.id ORDER BY empresas.id DESC`);
        // Busca as categorias para a aba SEO
        const [categoriasLista] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        res.render('admin', { empresas, categoriasLista });
    } catch (err) {
        console.error('Erro no Admin:', err);
        res.status(500).send('Erro interno');
    }
});

app.post('/admin/categorias/atualizar/:id', async (req, res) => {
    try {
        const { nome, palavras_chave } = req.body;
        await db.promise().execute('UPDATE categorias SET nome = ?, palavras_chave = ? WHERE id = ?', [nome, palavras_chave || null, req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        console.error('Erro ao atualizar categoria:', err);
        res.status(500).send('Erro ao atualizar categoria');
    }
});

app.post('/admin/categorias', async (req, res) => {
    try {
        const { nome_categoria } = req.body;
        const slug = (nome_categoria || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, '-').replace(/[^\w-]+/g, '');
        await db.promise().execute('INSERT IGNORE INTO categorias (nome, slug) VALUES (?, ?)', [nome_categoria, slug]);
        res.redirect('/admin');
    } catch (err) { 
        res.status(500).send('Erro ao criar categoria'); 
    }
});

app.get('/admin/nova', async (req, res) => {
    try {
        const [categorias] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        res.render('nova', { categorias });
    } catch (err) { 
        res.status(500).send(err); 
    }
});

app.post('/admin/nova', upload.fields([{ name: 'foto', maxCount: 1 }, { name: 'galeria', maxCount: 5 }]), async (req, res) => {
    try {
        const { nome, categoria_id, descricao, endereco, link_maps, whatsapp, site, facebook, instagram, plano_id, status, video_url } = req.body;
        const slug = (nome || '').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ /g, '-').replace(/[^\w-]+/g, '');
        let imagemUrl = null;
        if (req.files && req.files['foto']) imagemUrl = `/uploads/${req.files['foto'][0].filename}`;
        let galeriaJson = null;
        if (req.files && req.files['galeria']) {
            galeriaJson = JSON.stringify(req.files['galeria'].map(f => `/uploads/${f.filename}`));
        }
        const query = `INSERT INTO empresas (categoria_id, plano_id, nome, slug, descricao, endereco, link_maps, whatsapp, site, facebook, instagram, imagem, video_url, galeria, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await db.promise().execute(query, [categoria_id, plano_id, nome, slug, descricao || null, endereco, link_maps || null, whatsapp, site, facebook, instagram, imagemUrl, video_url || null, galeriaJson, status]);
        res.redirect('/admin');
    } catch (err) { 
        res.status(500).send('Erro ao salvar.'); 
    }
});

app.get('/admin/editar/:id', async (req, res) => {
    try {
        const [empresa] = await db.promise().execute('SELECT * FROM empresas WHERE id = ?', [req.params.id]);
        const [categorias] = await db.promise().execute('SELECT * FROM categorias ORDER BY nome ASC');
        res.render('editar', { empresa: empresa[0], categorias });
    } catch (err) { 
        res.status(500).send(err); 
    }
});

app.post('/admin/atualizar/:id', upload.fields([{ name: 'foto', maxCount: 1 }, { name: 'galeria', maxCount: 5 }]), async (req, res) => {
    try {
        const { nome, categoria_id, descricao, endereco, link_maps, whatsapp, site, facebook, instagram, plano_id, status, video_url } = req.body;
        let query = 'UPDATE empresas SET categoria_id=?, nome=?, descricao=?, endereco=?, link_maps=?, whatsapp=?, site=?, facebook=?, instagram=?, plano_id=?, status=?, video_url=?';
        let params = [categoria_id, nome, descricao || null, endereco, link_maps || null, whatsapp, site, facebook, instagram, plano_id, status, video_url || null];
        if (req.files && req.files['foto']) {
            query += ', imagem=?';
            params.push(`/uploads/${req.files['foto'][0].filename}`);
        }
        if (req.files && req.files['galeria'] && req.files['galeria'].length > 0) {
            query += ', galeria=?';
            params.push(JSON.stringify(req.files['galeria'].map(f => `/uploads/${f.filename}`)));
        }
        query += ' WHERE id=?';
        params.push(req.params.id);
        await db.promise().execute(query, params);
        res.redirect('/admin');
    } catch (err) { 
        res.status(500).send('Erro ao atualizar.'); 
    }
});

app.listen(port, () => console.log(`🚀 Servidor a rodar na porta ${port}`));