pipeline {
    agent any

    environment {
        IMAGE_NAME = "qlhd-server:latest"
        CONTAINER_NAME = "qlhd-server"
        APP_PORT = "3000"
    }

    stages {

        stage('Checkout source') {
            steps {
                checkout scm
            }
        }

        stage('Build Docker image (server)') {
            steps {
                dir('server') {
                    sh '''
                    echo "=== Build Docker image ==="
                    docker build -t ${IMAGE_NAME} .
                    '''
                }
            }
        }

        stage('Run container with env file') {
            steps {
                withCredentials([
                    file(credentialsId: 'qlhd-env-file', variable: 'ENV_FILE')
                ]) {
                    sh '''
                    echo "=== Copy .env to WORKSPACE ==="
                    cp "$ENV_FILE" "$WORKSPACE/.env"

                    echo "=== Stop old container if exists ==="
                    docker rm -f ${CONTAINER_NAME} || true

                    echo "=== Run new container ==="
                    docker run -d \
                      --name ${CONTAINER_NAME} \
                      --env-file "$WORKSPACE/.env" \
                      -p ${APP_PORT}:${APP_PORT} \
                      --restart always \
                      ${IMAGE_NAME}
                    '''
                }
            }
        }
    }

    post {
        success {
            echo "✅ DEPLOY SUCCESS: qlhd-server is running on port ${APP_PORT}"
        }
        failure {
            echo "❌ DEPLOY FAILED"
        }
    }
}
