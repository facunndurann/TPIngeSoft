workspace "Plataforma de Autoservicio para Restaurantes - Modelo C4" {
    !impliedRelationships false

    model {
        comensal = person "Comensal" "Accede por QR, realiza pedidos y consulta la cuenta."
        empleado = person "Empleado" "Opera comandas, mesas y cobros."
        administrador = person "Administrador" "Administra el restaurante, carta, sucursales y empleados."

        mp = softwareSystem "Mercado Pago" "Futuro: procesa pagos totales o divididos." {
            tags "Futuro"
        }
        llm = softwareSystem "OpenAI API" "Futuro: genera recomendaciones del menu." {
            tags "Futuro"
        }
        posExterno = softwareSystem "POS externo" "Futuro: recibe pedidos mediante un adaptador." {
            tags "Futuro"
        }

        plataforma = softwareSystem "Plataforma de Autoservicio para Restaurantes" "Menu por QR, pedidos y cuenta compartida para el comensal; comandas, salon y cobros para el personal; administracion de la carta, las sucursales y el equipo." {
            customer = container "Aplicacion del comensal" "Menu QR, personalizacion, carrito, pedidos, cuenta compartida y solicitudes al salon." "React + TypeScript / Vite" {
                tags "Web"
            }

            admin = container "Panel administrativo" "Gestiona restaurantes, sucursales, carta, precios, mesas, salon y cuentas de empleados." "React + TypeScript / Vite" {
                tags "Web"
            }

            pos = container "POS operativo" "Aplicacion independiente para empleados: comandas, mesas activas, plano del salon, cobros e historial. Usa una sesion propia con permisos por restaurante y sucursal." "React + TypeScript / Vite" {
                tags "Web"
            }

            group "Backend en Supabase" {
                api = container "API de datos" "Expone consultas y funciones SQL (RPC), con permisos, membresias y RLS." "Supabase Data API / PostgREST"

                auth = container "Autenticacion" "Administra sesiones anonimas de comensales, sesiones administrativas y cuentas globales de empleados." "Supabase Auth"

                realtime = container "Tiempo real" "Distribuye cambios autorizados de participantes, pedidos, cuenta, comandas y mesas." "Supabase Realtime"

                functions = container "Logica de negocio" "Procesa pedidos, pagos moviles y provision de cuentas de empleados. Futuro: recomendaciones, Mercado Pago y adaptadores POS."  "Supabase Edge Functions / Deno + TypeScript"

                db = container "Base de datos" "Restaurantes, sucursales, menus, mesas, sesiones, pedidos, pagos, perfiles, roles y permisos." "PostgreSQL" {
                    tags "Database"
                }

                storage = container "Almacenamiento de medios" "Conserva y sirve fotos y videos de los productos: lectura publica y escritura solo de administradores del restaurante." "Supabase Storage" {
                    tags "Storage"
                }
            }
        }

        # Nivel 1 (contexto). Explicitas a proposito: !impliedRelationships false no
        # las deriva de las de contenedor, y derivarlas dibujaria una flecha por cada
        # relacion subyacente (seis veces comensal -> plataforma).
        comensal -> plataforma "Escanea el QR de la mesa, pide y sigue su cuenta"
        empleado -> plataforma "Atiende comandas, mesas y cobros"
        administrador -> plataforma "Configura el restaurante, la carta y las cuentas del equipo"

        plataforma -> mp "Cobra el total o la parte de cada comensal (futuro)" "HTTPS / REST" {
            tags "Futuro"
        }
        mp -> plataforma "Notifica el resultado del pago (futuro)" "HTTPS / Webhook" {
            tags "Futuro"
        }
        plataforma -> llm "Pide recomendaciones sobre la carta (futuro)" "HTTPS / JSON" {
            tags "Futuro"
        }
        plataforma -> posExterno "Envia los pedidos al POS del restaurante (futuro)" "API del proveedor" {
            tags "Futuro"
        }

        # Nivel 2 (contenedores).
        comensal -> customer "Usa desde el QR de la mesa" "Navegador"
        empleado -> pos "Opera comandas, mesas y cobros" "Navegador"
        administrador -> admin "Administra el restaurante" "Navegador"
        # Owner y manager tambien entran al POS si tienen perfil de empleado y sucursal asignada
        # (docs/pos-accounts.md). Descomentar si el diagrama debe reflejarlo.
        # administrador -> pos "Opera el salon cuando tiene perfil de empleado" "Navegador"

        customer -> auth "Inicia y renueva sesion anonima" "HTTPS"
        admin -> auth "Inicia y renueva sesion administrativa" "HTTPS"
        pos -> auth "Inicia sesion con usuario (mapeado a un email interno) y contrasena" "HTTPS"

        customer -> api "Consulta la carta y la cuenta; se une a la mesa, divide y llama al salon" "HTTPS / REST y RPC"
        admin -> api "Administra carta, salon, mesas y configuracion" "HTTPS / REST y RPC"
        pos -> api "Consulta y actualiza comandas, mesas, pagos e historial" "HTTPS / REST y RPC"

        customer -> functions "Confirma pedidos y solicita pagos moviles" "HTTPS / JSON"
        admin -> functions "Crea y administra cuentas de empleados" "HTTPS / JSON"

        customer -> realtime "Recibe cambios de su mesa" "WSS"
        pos -> realtime "Recibe cambios de comandas y mesas" "WSS"

        customer -> storage "Descarga fotos y videos del menu" "HTTPS"
        admin -> storage "Sube, reemplaza y borra fotos y videos" "HTTPS"

        api -> db "Consulta datos y ejecuta RPC" "SQL"
        auth -> db "Persiste usuarios, perfiles y sesiones" "SQL"
        realtime -> db "Lee cambios autorizados" "Replicacion PostgreSQL"
        storage -> db "Gestiona metadatos y permisos de archivos" "SQL"
        functions -> api "Ejecuta operaciones de negocio validadas" "HTTPS / REST y RPC"
        functions -> auth "Valida el JWT del solicitante y provisiona cuentas de empleados" "HTTPS / GoTrue"

        functions -> mp "Crea y consulta pagos (futuro)" "HTTPS / REST" {
            tags "Futuro"
        }
        mp -> functions "Notifica pagos (futuro)" "HTTPS / Webhook" {
            tags "Futuro"
        }
        functions -> llm "Solicita recomendaciones (futuro)" "HTTPS / JSON" {
            tags "Futuro"
        }
        functions -> posExterno "Envia pedidos (futuro)" "API del proveedor" {
            tags "Futuro"
        }
    }

    views {
        systemContext plataforma "C4-Nivel-1" {
            title "Nivel 1 - Contexto de la Plataforma de Autoservicio para Restaurantes"
            include *
            autoLayout tb
        }

        container plataforma "C4-Nivel-2" {
            title "Nivel 2 - Contenedores de la Plataforma de Autoservicio para Restaurantes"
            include *
            autoLayout tb
        }

        styles {
            element "Element" {
                color #ffffff
            }
            element "Person" {
                shape Person
                background #16324f
            }
            element "Software System" {
                background #176b58
            }
            element "Container" {
                background #287f8e
            }
            element "Web" {
                shape WebBrowser
            }
            element "Database" {
                shape Cylinder
                background #425b76
            }
            element "Storage" {
                shape Cylinder
            }
            element "Futuro" {
                background #f2e5cb
                color #624619
                border Dashed
            }
            relationship "Relationship" {
                color #566573
                fontSize 20
            }
            relationship "Futuro" {
                color #99702e
                style Dashed
            }
        }
    }
}